package com.teleka.driver

import android.Manifest
import android.app.Application
import android.graphics.Bitmap
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.android.gms.location.LocationServices
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.CameraPositionState
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.rememberCameraPositionState
import com.teleka.core.data.AuthStatusResponse
import com.teleka.core.data.DriverDashboardResponse
import com.teleka.core.data.DriverRegistrationForm
import com.teleka.core.data.NotificationItem
import com.teleka.core.data.RideMessage
import com.teleka.core.data.RideSnapshot
import com.teleka.core.data.UploadItem
import com.teleka.core.network.TelekaRepository
import com.teleka.core.network.TelekaSocketClient
import com.teleka.core.ui.SectionCard
import com.teleka.core.ui.StatusChip
import com.teleka.core.ui.TelekaTheme
import com.teleka.core.util.formatCurrency
import com.teleka.core.util.formatDateTime
import com.teleka.core.util.formatStatus
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TelekaTheme {
                val viewModel: DriverViewModel = viewModel()
                DriverRoute(viewModel)
            }
        }
    }
}

private data class DriverUiState(
    val loading: Boolean = true,
    val banner: String = "Driver workspace offline",
    val auth: AuthStatusResponse = AuthStatusResponse(),
    val dashboard: DriverDashboardResponse = DriverDashboardResponse(),
    val notifications: List<NotificationItem> = emptyList(),
    val messages: List<RideMessage> = emptyList(),
    val selectedRideId: String? = null,
    val pendingAlertRideId: String? = null
)

class DriverViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = TelekaRepository(application, BuildConfig.TELEKA_BASE_URL)
    private val _ui = MutableStateFlow(DriverUiState())
    val ui: StateFlow<DriverUiState> = _ui.asStateFlow()

    private var socket: TelekaSocketClient? = null
    private var keepAliveJob: Job? = null
    private var locationJob: Job? = null

    init {
        bootstrap()
    }

    fun bootstrap() {
        viewModelScope.launch {
            runCatching {
                val auth = repository.authStatus()
                _ui.value = _ui.value.copy(
                    loading = false,
                    auth = auth,
                    banner = if (auth.authenticated) "Driver hub ready" else "Log in with an approved account or register"
                )
                if (auth.authenticated && auth.user?.role == "driver") {
                    connectRealtime()
                    startKeepAlive()
                    refreshAll()
                }
            }.onFailure {
                _ui.value = _ui.value.copy(loading = false, banner = it.message ?: "Unable to load driver app")
            }
        }
    }

    fun login(email: String, password: String) {
        viewModelScope.launch {
            runCatching {
                val auth = repository.driverLogin(email, password)
                _ui.value = _ui.value.copy(auth = auth, banner = "Driver session restored")
                connectRealtime()
                startKeepAlive()
                refreshAll()
            }.onFailure {
                _ui.value = _ui.value.copy(banner = it.message ?: "Unable to log in")
            }
        }
    }

    fun register(
        form: DriverRegistrationForm,
        facePhotoBytes: ByteArray?,
        carPhoto: UploadItem?,
        documents: List<UploadItem>
    ) {
        if (facePhotoBytes == null) {
            _ui.value = _ui.value.copy(banner = "Capture your face photo before submitting")
            return
        }
        viewModelScope.launch {
            runCatching {
                repository.registerDriver(getApplication(), form, facePhotoBytes, carPhoto, documents)
                _ui.value = _ui.value.copy(banner = "Registration submitted for admin review")
            }.onFailure {
                _ui.value = _ui.value.copy(banner = it.message ?: "Unable to submit registration")
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            repository.logout()
            socket?.disconnect()
            keepAliveJob?.cancel()
            stopLocationLoop()
            _ui.value = DriverUiState(loading = false, banner = "Signed out")
        }
    }

    fun toggleOnline(isOnline: Boolean) {
        viewModelScope.launch {
            runCatching {
                repository.updateAvailability(isOnline)
                refreshAll()
            }.onFailure {
                _ui.value = _ui.value.copy(banner = it.message ?: "Unable to update availability")
            }
        }
    }

    fun startLocationLoop() {
        if (locationJob != null) return
        val context = getApplication<Application>()
        val fused = LocationServices.getFusedLocationProviderClient(context)
        locationJob = viewModelScope.launch {
            while (true) {
                val isOnline = _ui.value.dashboard.profile?.isOnline == true
                if (isOnline) {
                    runCatching {
                        val location = fused.lastLocation.await()
                        if (location != null) {
                            repository.publishLocation(location.latitude, location.longitude, location.bearing.toDouble())
                        }
                    }
                }
                delay(12000)
            }
        }
    }

    fun stopLocationLoop() {
        locationJob?.cancel()
        locationJob = null
    }

    fun selectRide(rideId: String) {
        socket?.unwatchRide(_ui.value.selectedRideId)
        socket?.watchRide(rideId)
        _ui.value = _ui.value.copy(selectedRideId = rideId, pendingAlertRideId = null)
        refreshMessages()
    }

    fun acceptRide(rideId: String) {
        viewModelScope.launch {
            runCatching {
                repository.acceptRide(rideId)
                refreshAll()
            }.onFailure { _ui.value = _ui.value.copy(banner = it.message ?: "Unable to accept ride") }
        }
    }

    fun rejectRide(rideId: String) {
        viewModelScope.launch {
            runCatching {
                repository.rejectRide(rideId)
                refreshAll()
            }.onFailure { _ui.value = _ui.value.copy(banner = it.message ?: "Unable to reject ride") }
        }
    }

    fun startRide(rideId: String) {
        viewModelScope.launch {
            runCatching {
                repository.startRide(rideId)
                refreshAll()
            }.onFailure { _ui.value = _ui.value.copy(banner = it.message ?: "Unable to start trip") }
        }
    }

    fun completeRide(rideId: String, fare: Int) {
        viewModelScope.launch {
            runCatching {
                repository.completeRide(rideId, fare)
                refreshAll()
            }.onFailure { _ui.value = _ui.value.copy(banner = it.message ?: "Unable to complete ride") }
        }
    }

    fun sendMessage(body: String) {
        val rideId = _ui.value.selectedRideId ?: return
        viewModelScope.launch {
            runCatching {
                repository.driverSendMessage(rideId, body)
                refreshMessages()
            }.onFailure { _ui.value = _ui.value.copy(banner = it.message ?: "Unable to send message") }
        }
    }

    fun markNotificationRead(id: String) {
        viewModelScope.launch {
            repository.markNotificationRead(id)
            _ui.value = _ui.value.copy(notifications = repository.notifications().notifications)
        }
    }

    fun clearRideAlert() {
        _ui.value = _ui.value.copy(pendingAlertRideId = null)
    }

    private fun refreshAll() {
        viewModelScope.launch {
            val dashboard = repository.driverDashboard()
            val selectedRideId = _ui.value.selectedRideId
                ?: dashboard.rides.firstOrNull { it.status in listOf("assigned", "accepted", "in_progress") }?.id
            val alertRideId = dashboard.rides.firstOrNull { it.status == "assigned" }?.id
            _ui.value = _ui.value.copy(
                dashboard = dashboard,
                notifications = repository.notifications().notifications,
                selectedRideId = selectedRideId,
                pendingAlertRideId = alertRideId
            )
            if (selectedRideId != null) refreshMessages()
            if (dashboard.profile?.isOnline == true) startLocationLoop() else stopLocationLoop()
        }
    }

    private fun refreshMessages() {
        val rideId = _ui.value.selectedRideId ?: return
        viewModelScope.launch {
            _ui.value = _ui.value.copy(messages = repository.driverMessages(rideId).messages)
        }
    }

    private fun connectRealtime() {
        socket?.disconnect()
        socket = repository.createSocketClient().also { client ->
            client.connect(
                onNotification = {
                    _ui.value = _ui.value.copy(banner = it.title)
                    refreshAll()
                },
                onRideUpdated = { refreshAll() },
                onMessage = { message ->
                    if (message.rideId == _ui.value.selectedRideId) refreshMessages()
                }
            )
        }
    }

    private fun startKeepAlive() {
        keepAliveJob?.cancel()
        keepAliveJob = viewModelScope.launch {
            while (true) {
                delay(5 * 60 * 1000L)
                runCatching { repository.keepAlive() }
            }
        }
    }
}

@Composable
private fun DriverRoute(viewModel: DriverViewModel) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var selectedTab by remember { mutableIntStateOf(0) }
    val locationPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) viewModel.startLocationLoop()
    }

    LaunchedEffect(ui.banner) {
        if (ui.banner.isNotBlank()) snackbarHostState.showSnackbar(ui.banner)
    }

    if (ui.pendingAlertRideId != null) {
        val ride = ui.dashboard.rides.firstOrNull { it.id == ui.pendingAlertRideId }
        if (ride != null) {
            AlertDialog(
                onDismissRequest = { viewModel.clearRideAlert() },
                title = { Text("Dispatch needs your response") },
                text = { Text("${ride.originLabel} -> ${ride.destinationLabel}\n${formatCurrency(ride.quotedFareUgx)}") },
                confirmButton = { Button(onClick = { viewModel.acceptRide(ride.id) }) { Text("Accept") } },
                dismissButton = { OutlinedButton(onClick = { viewModel.rejectRide(ride.id) }) { Text("Reject") } }
            )
        }
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbarHostState) }) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    Text("Teleka Driver", style = MaterialTheme.typography.headlineSmall)
                    Text(if (ui.auth.authenticated) "Signed in" else "Signed out")
                }
                if (ui.auth.authenticated) {
                    OutlinedButton(onClick = viewModel::logout) { Text("Logout") }
                }
            }

            if (!ui.auth.authenticated) {
                DriverAuthCard(viewModel)
            } else {
                val tabs = listOf("Overview", "Rides", "Chat", "Alerts")
                TabRow(selectedTabIndex = selectedTab) {
                    tabs.forEachIndexed { index, label ->
                        Tab(selected = selectedTab == index, onClick = { selectedTab = index }, text = { Text(label) })
                    }
                }
                when (selectedTab) {
                    0 -> DriverOverviewTab(ui.dashboard, onToggleOnline = {
                        if (it) locationPermissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
                        viewModel.toggleOnline(it)
                    })
                    1 -> DriverRidesTab(ui.dashboard.rides, viewModel)
                    2 -> DriverChatTab(ui.selectedRideId, ui.messages, viewModel::sendMessage)
                    3 -> DriverAlertsTab(ui.notifications, viewModel::markNotificationRead)
                }
            }
        }
    }
}

@Composable
private fun DriverAuthCard(viewModel: DriverViewModel) {
    var selectedTab by remember { mutableIntStateOf(0) }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var fullName by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var vehicle by remember { mutableStateOf("") }
    var plate by remember { mutableStateOf("") }
    var license by remember { mutableStateOf("") }
    var nationalId by remember { mutableStateOf("") }
    var insurance by remember { mutableStateOf("") }
    var facePhotoBytes by remember { mutableStateOf<ByteArray?>(null) }
    var facePreview by remember { mutableStateOf<Bitmap?>(null) }
    var carPhotoUri by remember { mutableStateOf<UploadItem?>(null) }
    var documents by remember { mutableStateOf<List<UploadItem>>(emptyList()) }

    val takePicturePreview = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        if (bitmap != null) {
            facePreview = bitmap
            facePhotoBytes = bitmap.toJpegByteArray()
        }
    }
    val pickCarPhoto = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) carPhotoUri = UploadItem(uri)
    }
    val pickDocuments = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        documents = uris.map { UploadItem(it) }
    }

    SectionCard("Driver access", "Log in with an approved account or submit a new registration.") {
        TabRow(selectedTabIndex = selectedTab) {
            Tab(selected = selectedTab == 0, onClick = { selectedTab = 0 }, text = { Text("Login") })
            Tab(selected = selectedTab == 1, onClick = { selectedTab = 1 }, text = { Text("Register") })
        }
        if (selectedTab == 0) {
            OutlinedTextField(email, { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(password, { password = it }, label = { Text("Password") }, modifier = Modifier.fillMaxWidth())
            Spacer(Modifier.height(12.dp))
            Button(onClick = { viewModel.login(email, password) }) { Text("Log in") }
        } else {
            listOf(
                "Full name" to fullName,
                "Email" to email,
                "Phone" to phone,
                "Password" to password,
                "Vehicle" to vehicle,
                "Plate number" to plate,
                "License number" to license,
                "National ID number" to nationalId,
                "Insurance number" to insurance
            ).forEach { (label, value) ->
                OutlinedTextField(
                    value = value,
                    onValueChange = {
                        when (label) {
                            "Full name" -> fullName = it
                            "Email" -> email = it
                            "Phone" -> phone = it
                            "Password" -> password = it
                            "Vehicle" -> vehicle = it
                            "Plate number" -> plate = it
                            "License number" -> license = it
                            "National ID number" -> nationalId = it
                            else -> insurance = it
                        }
                    },
                    label = { Text(label) },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { takePicturePreview.launch(null) }) { Text("Capture face") }
                OutlinedButton(onClick = { pickCarPhoto.launch("image/*") }) { Text("Car photo") }
                OutlinedButton(onClick = { pickDocuments.launch(arrayOf("image/*", "application/pdf")) }) { Text("Documents") }
            }
            facePreview?.let {
                Spacer(Modifier.height(8.dp))
                Image(bitmap = it.asImageBitmap(), contentDescription = "Face preview", modifier = Modifier.fillMaxWidth())
            }
            Text("Documents selected: ${documents.size}")
            Spacer(Modifier.height(12.dp))
            Button(onClick = {
                viewModel.register(
                    DriverRegistrationForm(
                        fullName = fullName,
                        email = email,
                        phone = phone,
                        password = password,
                        vehicle = vehicle,
                        plateNumber = plate,
                        licenseNumber = license,
                        nationalIdNumber = nationalId,
                        insuranceNumber = insurance
                    ),
                    facePhotoBytes = facePhotoBytes,
                    carPhoto = carPhotoUri,
                    documents = documents
                )
            }) { Text("Submit driver application") }
        }
    }
}

@Composable
private fun DriverOverviewTab(
    dashboard: DriverDashboardResponse,
    onToggleOnline: (Boolean) -> Unit
) {
    val profile = dashboard.profile
    SectionCard("Driver profile", profile?.fullName ?: "Driver") {
        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
            Column {
                Text("Vehicle: ${profile?.vehicle ?: "-"}")
                Text("Plate: ${profile?.plateNumber ?: "-"}")
                Text("Status: ${formatStatus(profile?.approvalStatus)}")
                Text("Earnings: ${formatCurrency(dashboard.stats.earningsUgx)}")
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Online")
                Switch(checked = profile?.isOnline == true, onCheckedChange = onToggleOnline)
            }
        }
        Spacer(Modifier.height(12.dp))
        val ride = dashboard.rides.firstOrNull { it.status in listOf("assigned", "accepted", "in_progress") }
        val cameraPositionState = rememberCameraPositionState {
            position = CameraPosition.fromLatLngZoom(LatLng(0.3136, 32.5811), 12f)
        }
        GoogleMap(
            modifier = Modifier
                .fillMaxWidth()
                .height(260.dp),
            cameraPositionState = cameraPositionState
        ) {
            profile?.currentLat?.let { lat ->
                profile.currentLng?.let { lng ->
                    Marker(MarkerState(LatLng(lat, lng)), title = "You")
                }
            }
            ride?.originLat?.let { lat ->
                ride.originLng?.let { lng ->
                    Marker(MarkerState(LatLng(lat, lng)), title = "Pickup", snippet = ride.originLabel)
                }
            }
            ride?.destinationLat?.let { lat ->
                ride.destinationLng?.let { lng ->
                    Marker(MarkerState(LatLng(lat, lng)), title = "Destination", snippet = ride.destinationLabel)
                }
            }
        }
    }
}

@Composable
private fun DriverRidesTab(rides: List<RideSnapshot>, viewModel: DriverViewModel) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(rides) { ride ->
            var finalFare by remember(ride.id) { mutableStateOf((ride.quotedFareUgx ?: 0).toString()) }
            SectionCard("${ride.originLabel} -> ${ride.destinationLabel}", ride.customerName ?: "Customer") {
                StatusChip(formatStatus(ride.status))
                Spacer(Modifier.height(8.dp))
                Text("Fare: ${formatCurrency(ride.finalFareUgx ?: ride.quotedFareUgx)}")
                Text("Requested: ${formatDateTime(ride.requestedAt)}")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    when (ride.status) {
                        "assigned" -> {
                            Button(onClick = { viewModel.acceptRide(ride.id) }) { Text("Accept") }
                            OutlinedButton(onClick = { viewModel.rejectRide(ride.id) }) { Text("Reject") }
                        }
                        "accepted" -> Button(onClick = { viewModel.startRide(ride.id) }) { Text("Start trip") }
                        "in_progress" -> {
                            OutlinedTextField(
                                value = finalFare,
                                onValueChange = { finalFare = it },
                                label = { Text("Final fare") }
                            )
                            Button(onClick = { viewModel.completeRide(ride.id, finalFare.toIntOrNull() ?: 0) }) {
                                Text("Complete")
                            }
                        }
                    }
                }
                TextButton(onClick = { viewModel.selectRide(ride.id) }) { Text("Open trip chat") }
            }
        }
    }
}

@Composable
private fun DriverChatTab(selectedRideId: String?, messages: List<RideMessage>, onSend: (String) -> Unit) {
    var draft by remember(selectedRideId) { mutableStateOf("") }
    SectionCard(
        title = if (selectedRideId == null) "Ride chat" else "Ride ${selectedRideId.take(8)}",
        subtitle = "Coordinate directly with the customer."
    ) {
        if (selectedRideId == null) {
            Text("Select a ride first.")
        } else {
            messages.forEach { message ->
                Text("${if (message.senderRole == "driver") "You" else "Customer"}: ${message.body}")
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(draft, { draft = it }, label = { Text("Message") }, modifier = Modifier.fillMaxWidth())
            Button(
                onClick = {
                    onSend(draft)
                    draft = ""
                },
                enabled = draft.isNotBlank()
            ) { Text("Send") }
        }
    }
}

@Composable
private fun DriverAlertsTab(notifications: List<NotificationItem>, onRead: (String) -> Unit) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(notifications) { notification ->
            SectionCard(notification.title, notification.message) {
                Text(formatDateTime(notification.createdAt))
                if (notification.readAt == null) {
                    TextButton(onClick = { onRead(notification.id) }) { Text("Mark read") }
                }
            }
        }
    }
}

private fun Bitmap.toJpegByteArray(): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    compress(Bitmap.CompressFormat.JPEG, 92, output)
    return output.toByteArray()
}
