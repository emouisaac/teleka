package com.teleka.admin

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.maps.android.compose.CameraPositionState
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.rememberCameraPositionState
import com.teleka.core.data.AdminDashboardResponse
import com.teleka.core.data.AuthStatusResponse
import com.teleka.core.data.DriverDocumentsResponse
import com.teleka.core.data.DriverProfile
import com.teleka.core.data.FareSettings
import com.teleka.core.data.NotificationItem
import com.teleka.core.data.PublicConfigResponse
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

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TelekaTheme {
                val viewModel: AdminViewModel = viewModel()
                AdminRoute(viewModel)
            }
        }
    }
}

private data class AdminUiState(
    val loading: Boolean = true,
    val banner: String = "Admin console offline",
    val auth: AuthStatusResponse = AuthStatusResponse(),
    val publicConfig: PublicConfigResponse = PublicConfigResponse(),
    val dashboard: AdminDashboardResponse = AdminDashboardResponse(),
    val notifications: List<NotificationItem> = emptyList(),
    val documents: DriverDocumentsResponse? = null
)

class AdminViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = TelekaRepository(application, BuildConfig.TELEKA_BASE_URL)
    private val _ui = MutableStateFlow(AdminUiState())
    val ui: StateFlow<AdminUiState> = _ui.asStateFlow()

    private var socket: TelekaSocketClient? = null
    private var keepAliveJob: Job? = null

    init {
        bootstrap()
    }

    fun bootstrap() {
        viewModelScope.launch {
            runCatching {
                val config = repository.publicConfig()
                val auth = repository.authStatus()
                _ui.value = _ui.value.copy(
                    loading = false,
                    publicConfig = config,
                    auth = auth,
                    banner = if (auth.authenticated) "Admin console ready" else "Sign in with admin credentials"
                )
                if (auth.authenticated && auth.user?.role == "admin") {
                    connectRealtime()
                    startKeepAlive()
                    refreshAll()
                }
            }.onFailure {
                _ui.value = _ui.value.copy(loading = false, banner = it.message ?: "Unable to load admin app")
            }
        }
    }

    fun login(email: String, password: String) {
        viewModelScope.launch {
            runCatching {
                val auth = repository.adminLogin(email, password)
                _ui.value = _ui.value.copy(auth = auth, banner = "Admin session restored")
                connectRealtime()
                startKeepAlive()
                refreshAll()
            }.onFailure {
                _ui.value = _ui.value.copy(banner = it.message ?: "Invalid admin credentials")
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            repository.logout()
            socket?.disconnect()
            keepAliveJob?.cancel()
            _ui.value = AdminUiState(loading = false, publicConfig = _ui.value.publicConfig, banner = "Signed out")
        }
    }

    fun approveDriver(driverId: String, notes: String?) {
        viewModelScope.launch {
            runCatching {
                repository.approveDriver(driverId, notes)
                refreshAll()
            }.onFailure { _ui.value = _ui.value.copy(banner = it.message ?: "Unable to approve driver") }
        }
    }

    fun rejectDriver(driverId: String, notes: String?) {
        viewModelScope.launch {
            runCatching {
                repository.rejectDriver(driverId, notes)
                refreshAll()
            }.onFailure { _ui.value = _ui.value.copy(banner = it.message ?: "Unable to reject driver") }
        }
    }

    fun assignRide(rideId: String, driverId: String) {
        viewModelScope.launch {
            runCatching {
                repository.assignRide(rideId, driverId)
                refreshAll()
            }.onFailure { _ui.value = _ui.value.copy(banner = it.message ?: "Unable to assign ride") }
        }
    }

    fun cancelRide(rideId: String) {
        viewModelScope.launch {
            runCatching {
                repository.cancelRide(rideId)
                refreshAll()
            }.onFailure { _ui.value = _ui.value.copy(banner = it.message ?: "Unable to cancel ride") }
        }
    }

    fun loadDocuments(driverId: String) {
        viewModelScope.launch {
            runCatching {
                _ui.value = _ui.value.copy(documents = repository.driverDocuments(driverId))
            }.onFailure {
                _ui.value = _ui.value.copy(banner = it.message ?: "Unable to load documents")
            }
        }
    }

    fun saveFareSettings(fare: FareSettings) {
        viewModelScope.launch {
            runCatching {
                repository.saveFareSettings(fare)
                refreshAll()
            }.onFailure { _ui.value = _ui.value.copy(banner = it.message ?: "Unable to save fare settings") }
        }
    }

    fun markNotificationRead(id: String) {
        viewModelScope.launch {
            repository.markNotificationRead(id)
            _ui.value = _ui.value.copy(notifications = repository.notifications().notifications)
        }
    }

    private fun refreshAll() {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(
                dashboard = repository.adminDashboard(),
                notifications = repository.notifications().notifications
            )
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
                onDriverUpdated = { refreshAll() },
                onSettingsUpdated = { refreshAll() }
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
private fun AdminRoute(viewModel: AdminViewModel) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var selectedTab by remember { mutableIntStateOf(0) }

    LaunchedEffect(ui.banner) {
        if (ui.banner.isNotBlank()) snackbarHostState.showSnackbar(ui.banner)
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    Text("Teleka Admin", style = MaterialTheme.typography.headlineSmall)
                    Text(if (ui.auth.authenticated) "Signed in" else "Signed out")
                }
                if (ui.auth.authenticated) {
                    OutlinedButton(onClick = viewModel::logout) { Text("Logout") }
                }
            }

            if (!ui.auth.authenticated) {
                LoginCard(viewModel::login)
            } else {
                val tabs = listOf("Overview", "Rides", "Drivers", "Pricing", "Alerts")
                TabRow(selectedTabIndex = selectedTab) {
                    tabs.forEachIndexed { index, label ->
                        Tab(selected = selectedTab == index, onClick = { selectedTab = index }, text = { Text(label) })
                    }
                }

                when (selectedTab) {
                    0 -> OverviewTab(ui.dashboard)
                    1 -> RidesTab(ui.dashboard, viewModel)
                    2 -> DriversTab(ui.dashboard.drivers, ui.documents, viewModel)
                    3 -> PricingTab(ui.dashboard.settings.fare, viewModel::saveFareSettings)
                    4 -> AlertsTab(ui.notifications, viewModel::markNotificationRead)
                }
            }
        }
    }
}

@Composable
private fun LoginCard(onLogin: (String, String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    SectionCard("Admin sign in", "Use the same admin credentials configured on the Node backend.") {
        OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(value = password, onValueChange = { password = it }, label = { Text("Password") }, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(12.dp))
        Button(onClick = { onLogin(email, password) }) { Text("Sign in") }
    }
}

@Composable
private fun OverviewTab(dashboard: AdminDashboardResponse) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            SectionCard("Platform health", "Realtime summary from `/api/admin/dashboard`.") {
                val cards = listOf(
                    "Customers" to dashboard.summary.customers.toString(),
                    "Drivers" to dashboard.summary.drivers.toString(),
                    "Approved drivers" to dashboard.summary.approvedDrivers.toString(),
                    "Drivers online" to dashboard.summary.driversOnline.toString(),
                    "Pending rides" to dashboard.summary.pendingRides.toString(),
                    "Active rides" to dashboard.summary.activeRides.toString(),
                    "Completed rides" to dashboard.summary.completedRides.toString(),
                    "Revenue" to formatCurrency(dashboard.summary.totalRevenueUgx)
                )
                cards.forEach { (label, value) -> Text("$label: $value") }
            }
        }
        item {
            SectionCard("Driver map", "Live positions for drivers that have shared coordinates.") {
                val cameraPositionState = rememberCameraPositionState {
                    position = CameraPosition.fromLatLngZoom(LatLng(0.3136, 32.5811), 11f)
                }
                GoogleMap(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(260.dp),
                    cameraPositionState = cameraPositionState
                ) {
                    dashboard.drivers
                        .filter { it.currentLat != null && it.currentLng != null }
                        .forEach { driver ->
                            Marker(
                                state = MarkerState(LatLng(driver.currentLat!!, driver.currentLng!!)),
                                title = driver.fullName,
                                snippet = "${driver.vehicle} • ${formatStatus(driver.approvalStatus)}"
                            )
                        }
                }
            }
        }
    }
}

@Composable
private fun RidesTab(dashboard: AdminDashboardResponse, viewModel: AdminViewModel) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(dashboard.rides) { ride ->
            var driverId by remember(ride.id) { mutableStateOf(ride.driverId.orEmpty()) }
            SectionCard("${ride.originLabel} -> ${ride.destinationLabel}", ride.customerName ?: "Customer") {
                StatusChip(formatStatus(ride.status))
                Spacer(Modifier.height(8.dp))
                Text("Fare: ${formatCurrency(ride.finalFareUgx ?: ride.quotedFareUgx)}")
                Text("Vehicle: ${formatStatus(ride.requestedVehicleClass)}")
                Text("Current driver: ${ride.driverName ?: "Unassigned"}")
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = driverId,
                    onValueChange = { driverId = it },
                    label = { Text("Driver ID") },
                    modifier = Modifier.fillMaxWidth()
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { viewModel.assignRide(ride.id, driverId) }, enabled = driverId.isNotBlank()) {
                        Text(if (ride.driverId == null) "Assign" else "Reassign")
                    }
                    OutlinedButton(onClick = { viewModel.cancelRide(ride.id) }) { Text("Reject") }
                }
            }
        }
    }
}

@Composable
private fun DriversTab(
    drivers: List<DriverProfile>,
    documents: DriverDocumentsResponse?,
    viewModel: AdminViewModel
) {
    val context = LocalContext.current
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        items(drivers) { driver ->
            var notes by remember(driver.id) { mutableStateOf(driver.approvalNotes.orEmpty()) }
            SectionCard(driver.fullName, "${driver.vehicle} • ${driver.plateNumber}") {
                StatusChip(formatStatus(driver.approvalStatus))
                Spacer(Modifier.height(8.dp))
                Text("Email: ${driver.email}")
                Text("Phone: ${driver.phone}")
                Text("Docs: ${driver.documentCount}")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { viewModel.approveDriver(driver.id, notes) }) { Text("Approve") }
                    OutlinedButton(onClick = { viewModel.rejectDriver(driver.id, notes) }) { Text("Reject") }
                    TextButton(onClick = { viewModel.loadDocuments(driver.id) }) { Text("Docs") }
                }
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text("Notes") },
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }

        documents?.let { payload ->
            item {
                SectionCard("Driver documents", payload.driver.fullName) {
                    payload.driver.facePhotoUrl?.let { url ->
                        TextButton(onClick = {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        }) { Text("Open face photo") }
                    }
                    payload.driver.carPhotoUrl?.let { url ->
                        TextButton(onClick = {
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        }) { Text("Open car photo") }
                    }
                    payload.documents.forEach { document ->
                        TextButton(onClick = {
                            val url = document.downloadUrl ?: return@TextButton
                            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        }) {
                            Text("${formatStatus(document.documentType)} • ${document.originalName}")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun PricingTab(fare: FareSettings, onSave: (FareSettings) -> Unit) {
    var base by remember { mutableStateOf(fare.baseFareUgx.toString()) }
    var booking by remember { mutableStateOf(fare.bookingFeeUgx.toString()) }
    var perKm by remember { mutableStateOf(fare.perKmUgx.toString()) }
    var perMinute by remember { mutableStateOf(fare.perMinuteUgx.toString()) }
    var minimum by remember { mutableStateOf(fare.minimumFareUgx.toString()) }

    SectionCard("Fare settings", "These values are stored in the backend settings table.") {
        OutlinedTextField(base, { base = it }, label = { Text("Base fare") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(booking, { booking = it }, label = { Text("Booking fee") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(perKm, { perKm = it }, label = { Text("Per kilometre") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(perMinute, { perMinute = it }, label = { Text("Per minute") }, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(minimum, { minimum = it }, label = { Text("Minimum fare") }, modifier = Modifier.fillMaxWidth())
        Button(
            onClick = {
                onSave(
                    FareSettings(
                        baseFareUgx = base.toIntOrNull() ?: 0,
                        bookingFeeUgx = booking.toIntOrNull() ?: 0,
                        perKmUgx = perKm.toIntOrNull() ?: 0,
                        perMinuteUgx = perMinute.toIntOrNull() ?: 0,
                        minimumFareUgx = minimum.toIntOrNull() ?: 0
                    )
                )
            }
        ) { Text("Save fare settings") }
    }
}

@Composable
private fun AlertsTab(notifications: List<NotificationItem>, onRead: (String) -> Unit) {
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
