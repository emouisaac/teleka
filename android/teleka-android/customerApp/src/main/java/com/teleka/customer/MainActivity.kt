package com.teleka.customer

import android.Manifest
import android.app.Activity
import android.app.Application
import android.location.Geocoder
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.google.android.gms.location.LocationServices
import com.google.android.gms.maps.model.CameraPosition
import com.google.android.gms.maps.model.LatLng
import com.google.android.gms.maps.model.LatLngBounds
import com.google.maps.android.compose.CameraPositionState
import com.google.maps.android.compose.GoogleMap
import com.google.maps.android.compose.MapProperties
import com.google.maps.android.compose.Marker
import com.google.maps.android.compose.MarkerState
import com.google.maps.android.compose.Polyline
import com.google.maps.android.compose.rememberCameraPositionState
import com.teleka.core.data.AuthStatusResponse
import com.teleka.core.data.CreateRideRequest
import com.teleka.core.data.CustomerDashboardResponse
import com.teleka.core.data.FareSettings
import com.teleka.core.data.NotificationItem
import com.teleka.core.data.PlaceSuggestion
import com.teleka.core.data.PublicConfigResponse
import com.teleka.core.data.RideMessage
import com.teleka.core.data.RideSnapshot
import com.teleka.core.data.RouteQuote
import com.teleka.core.network.TelekaRepository
import com.teleka.core.network.TelekaSocketClient
import com.teleka.core.ui.SectionCard
import com.teleka.core.ui.StatusChip
import com.teleka.core.ui.TelekaTheme
import com.teleka.core.util.decodePolyline
import com.teleka.core.util.formatCurrency
import com.teleka.core.util.formatDateTime
import com.teleka.core.util.formatStatus
import java.util.Locale
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            TelekaTheme {
                val viewModel: CustomerViewModel = viewModel()
                CustomerRoute(viewModel)
            }
        }
    }
}

private data class CustomerUiState(
    val loading: Boolean = true,
    val banner: String = "Loading customer workspace",
    val publicConfig: PublicConfigResponse = PublicConfigResponse(),
    val settings: FareSettings = FareSettings(),
    val auth: AuthStatusResponse = AuthStatusResponse(),
    val dashboard: CustomerDashboardResponse = CustomerDashboardResponse(),
    val notifications: List<NotificationItem> = emptyList(),
    val messages: List<RideMessage> = emptyList(),
    val pickupQuery: String = "",
    val destinationQuery: String = "",
    val pickupSuggestions: List<PlaceSuggestion> = emptyList(),
    val destinationSuggestions: List<PlaceSuggestion> = emptyList(),
    val pickupPlace: PlaceSuggestion? = null,
    val destinationPlace: PlaceSuggestion? = null,
    val selectedVehicleClass: String = "standard",
    val quote: RouteQuote? = null,
    val selectedRideId: String? = null
)

class CustomerViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = TelekaRepository(application, BuildConfig.TELEKA_BASE_URL)
    private val _ui = MutableStateFlow(CustomerUiState())
    val ui: StateFlow<CustomerUiState> = _ui.asStateFlow()

    private var socket: TelekaSocketClient? = null
    private var keepAliveJob: Job? = null
    private var pickupSearchJob: Job? = null
    private var destinationSearchJob: Job? = null

    init {
        bootstrap()
    }

    fun bootstrap() {
        viewModelScope.launch {
            runCatching {
                val config = repository.publicConfig()
                val settings = repository.publicSettings().settings.fare
                val auth = repository.authStatus()
                _ui.value = _ui.value.copy(
                    publicConfig = config,
                    settings = settings,
                    auth = auth,
                    loading = false,
                    banner = if (auth.authenticated) "Customer panel ready" else "Sign in with Google to request rides"
                )
                if (auth.authenticated && auth.user?.role == "customer") {
                    connectRealtime()
                    startKeepAlive()
                    refreshDashboard()
                    refreshNotifications()
                }
            }.onFailure {
                _ui.value = _ui.value.copy(loading = false, banner = it.message ?: "Unable to load app")
            }
        }
    }

    fun signInWithGoogleToken(token: String) {
        viewModelScope.launch {
            runCatching {
                val auth = repository.googleLogin(token)
                _ui.value = _ui.value.copy(auth = auth, banner = "Google sign-in complete")
                connectRealtime()
                startKeepAlive()
                refreshDashboard()
                refreshNotifications()
            }.onFailure {
                _ui.value = _ui.value.copy(banner = it.message ?: "Google sign-in failed")
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            repository.logout()
            socket?.disconnect()
            keepAliveJob?.cancel()
            _ui.value = CustomerUiState(
                loading = false,
                banner = "Signed out",
                publicConfig = _ui.value.publicConfig,
                settings = _ui.value.settings
            )
        }
    }

    fun updatePickupQuery(query: String) {
        _ui.value = _ui.value.copy(pickupQuery = query, pickupPlace = null, quote = null)
        pickupSearchJob?.cancel()
        pickupSearchJob = viewModelScope.launch {
            delay(350)
            val suggestions = if (query.length >= 3) repository.autocompletePlaces(query).suggestions else emptyList()
            _ui.value = _ui.value.copy(pickupSuggestions = suggestions)
        }
    }

    fun updateDestinationQuery(query: String) {
        _ui.value = _ui.value.copy(destinationQuery = query, destinationPlace = null, quote = null)
        destinationSearchJob?.cancel()
        destinationSearchJob = viewModelScope.launch {
            delay(350)
            val suggestions = if (query.length >= 3) repository.autocompletePlaces(query).suggestions else emptyList()
            _ui.value = _ui.value.copy(destinationSuggestions = suggestions)
        }
    }

    fun choosePickup(place: PlaceSuggestion) {
        _ui.value = _ui.value.copy(
            pickupPlace = place,
            pickupQuery = place.address,
            pickupSuggestions = emptyList()
        )
        rebuildQuote()
    }

    fun chooseDestination(place: PlaceSuggestion) {
        _ui.value = _ui.value.copy(
            destinationPlace = place,
            destinationQuery = place.address,
            destinationSuggestions = emptyList()
        )
        rebuildQuote()
    }

    fun selectVehicle(vehicleClass: String) {
        _ui.value = _ui.value.copy(selectedVehicleClass = vehicleClass)
        rebuildQuote()
    }

    fun requestRide() {
        val current = _ui.value
        val quote = current.quote ?: run {
            _ui.value = current.copy(banner = "Build a route first")
            return
        }
        if (!current.auth.authenticated) {
            _ui.value = current.copy(banner = "Sign in first")
            return
        }

        viewModelScope.launch {
            runCatching {
                val ride = repository.createRide(
                    CreateRideRequest(
                        origin = current.pickupPlace ?: PlaceSuggestion(
                            label = quote.origin.label,
                            address = quote.origin.address,
                            placeId = quote.origin.placeId,
                            lat = quote.origin.lat,
                            lng = quote.origin.lng
                        ),
                        destination = current.destinationPlace ?: PlaceSuggestion(
                            label = quote.destination.label,
                            address = quote.destination.address,
                            placeId = quote.destination.placeId,
                            lat = quote.destination.lat,
                            lng = quote.destination.lng
                        ),
                        paymentMethod = "cash",
                        vehicleClass = current.selectedVehicleClass
                    )
                )
                _ui.value = _ui.value.copy(
                    selectedRideId = ride.ride?.id,
                    quote = null,
                    banner = "Ride request submitted"
                )
                refreshDashboard()
                refreshNotifications()
            }.onFailure {
                _ui.value = _ui.value.copy(banner = it.message ?: "Unable to request ride")
            }
        }
    }

    fun selectRide(rideId: String) {
        socket?.unwatchRide(_ui.value.selectedRideId)
        socket?.watchRide(rideId)
        _ui.value = _ui.value.copy(selectedRideId = rideId, banner = "Opened ride ${rideId.take(8)}")
        refreshMessages()
    }

    fun sendMessage(body: String) {
        val rideId = _ui.value.selectedRideId ?: return
        viewModelScope.launch {
            runCatching {
                repository.customerSendMessage(rideId, body)
                refreshMessages()
            }.onFailure {
                _ui.value = _ui.value.copy(banner = it.message ?: "Unable to send message")
            }
        }
    }

    fun markNotificationRead(id: String) {
        viewModelScope.launch {
            repository.markNotificationRead(id)
            refreshNotifications()
        }
    }

    fun useCurrentLocation(lat: Double, lng: Double, address: String) {
        val place = PlaceSuggestion(
            label = address,
            address = address,
            lat = lat,
            lng = lng
        )
        _ui.value = _ui.value.copy(
            pickupPlace = place,
            pickupQuery = address,
            banner = "Pickup filled from your current location"
        )
        rebuildQuote()
    }

    private fun rebuildQuote() {
        val state = _ui.value
        val origin = state.pickupPlace ?: return
        val destination = state.destinationPlace ?: return
        val mapsApiKey = state.publicConfig.googleMapsApiKey
        if (mapsApiKey.isBlank()) {
            _ui.value = state.copy(banner = "Google Maps key is missing on this deployment")
            return
        }

        viewModelScope.launch {
            runCatching {
                repository.buildQuote(
                    origin = origin,
                    destination = destination,
                    fareSettings = _ui.value.settings,
                    selectedVehicleClass = _ui.value.selectedVehicleClass,
                    mapsApiKey = mapsApiKey
                )
            }.onSuccess { quote ->
                _ui.value = _ui.value.copy(quote = quote, selectedVehicleClass = quote.selectedVehicleClass)
            }.onFailure {
                _ui.value = _ui.value.copy(banner = it.message ?: "Unable to calculate route", quote = null)
            }
        }
    }

    private fun refreshDashboard() {
        viewModelScope.launch {
            val dashboard = repository.customerDashboard()
            val selectedRideId = _ui.value.selectedRideId
                ?: dashboard.rides.firstOrNull { it.status in listOf("assigned", "accepted", "in_progress") }?.id
            _ui.value = _ui.value.copy(dashboard = dashboard, selectedRideId = selectedRideId)
            if (selectedRideId != null) refreshMessages()
        }
    }

    private fun refreshMessages() {
        val rideId = _ui.value.selectedRideId ?: return
        viewModelScope.launch {
            val messages = repository.customerMessages(rideId).messages
            _ui.value = _ui.value.copy(messages = messages)
        }
    }

    private fun refreshNotifications() {
        viewModelScope.launch {
            _ui.value = _ui.value.copy(notifications = repository.notifications().notifications)
        }
    }

    private fun connectRealtime() {
        socket?.disconnect()
        socket = repository.createSocketClient().also { client ->
            client.connect(
                onNotification = {
                    _ui.value = _ui.value.copy(banner = it.title)
                    refreshNotifications()
                },
                onRideUpdated = {
                    refreshDashboard()
                },
                onSettingsUpdated = { key ->
                    if (key == "fare") {
                        viewModelScope.launch {
                            _ui.value = _ui.value.copy(settings = repository.publicSettings().settings.fare)
                            rebuildQuote()
                        }
                    }
                },
                onMessage = { message ->
                    if (message.rideId == _ui.value.selectedRideId) refreshMessages()
                }
            )
            client.watchRide(_ui.value.selectedRideId)
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

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CustomerRoute(viewModel: CustomerViewModel) {
    val ui by viewModel.ui.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var selectedTab by remember { mutableIntStateOf(0) }
    val context = LocalContext.current
    val activity = context as Activity
    val locationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            requestCurrentLocation(context, viewModel)
        }
    }

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
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column {
                    Text("Teleka Customer", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        if (ui.auth.authenticated) ui.auth.user?.fullName ?: "Signed in" else "Signed out",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
                if (ui.auth.authenticated) {
                    OutlinedButton(onClick = viewModel::logout) { Text("Logout") }
                }
            }

            if (!ui.auth.authenticated) {
                SectionCard(
                    title = "Customer access",
                    subtitle = "Use the same backend Google login flow from the web app."
                ) {
                    Button(
                        onClick = {
                            launchGoogleSignIn(activity, ui.publicConfig.googleClientId, viewModel)
                        },
                        enabled = ui.publicConfig.googleClientId.isNotBlank()
                    ) {
                        Text(if (ui.publicConfig.googleClientId.isBlank()) "Google not configured" else "Continue with Google")
                    }
                }
            }

            val tabs = listOf("Request", "Trips", "Chat", "Alerts")
            TabRow(selectedTabIndex = selectedTab) {
                tabs.forEachIndexed { index, label ->
                    Tab(selected = selectedTab == index, onClick = { selectedTab = index }, text = { Text(label) })
                }
            }

            when (selectedTab) {
                0 -> RequestTab(
                    ui = ui,
                    onPickupChange = viewModel::updatePickupQuery,
                    onDestinationChange = viewModel::updateDestinationQuery,
                    onPickupSelected = viewModel::choosePickup,
                    onDestinationSelected = viewModel::chooseDestination,
                    onVehicleSelected = viewModel::selectVehicle,
                    onRequestRide = viewModel::requestRide,
                    onUseMyLocation = {
                        locationPermissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
                    }
                )
                1 -> TripsTab(ui.dashboard.rides, ui.selectedRideId, viewModel::selectRide)
                2 -> ChatTab(ui, viewModel::sendMessage)
                3 -> AlertsTab(ui.notifications, viewModel::markNotificationRead)
            }
        }
    }
}

@Composable
private fun RequestTab(
    ui: CustomerUiState,
    onPickupChange: (String) -> Unit,
    onDestinationChange: (String) -> Unit,
    onPickupSelected: (PlaceSuggestion) -> Unit,
    onDestinationSelected: (PlaceSuggestion) -> Unit,
    onVehicleSelected: (String) -> Unit,
    onRequestRide: () -> Unit,
    onUseMyLocation: () -> Unit
) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            SectionCard(
                title = "Create a trip",
                subtitle = "This mirrors the web customer request flow: address search, route estimate, vehicle choice, and request submission."
            ) {
                OutlinedTextField(
                    value = ui.pickupQuery,
                    onValueChange = onPickupChange,
                    label = { Text("Pickup") },
                    modifier = Modifier.fillMaxWidth()
                )
                SuggestionList(ui.pickupSuggestions, onPickupSelected)
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = ui.destinationQuery,
                    onValueChange = onDestinationChange,
                    label = { Text("Destination") },
                    modifier = Modifier.fillMaxWidth()
                )
                SuggestionList(ui.destinationSuggestions, onDestinationSelected)
                Spacer(modifier = Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("mini", "standard", "premium", "suv").forEach { option ->
                        TextButton(onClick = { onVehicleSelected(option) }) {
                            Text(formatStatus(option))
                        }
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    OutlinedButton(onClick = onUseMyLocation) { Text("Use my location") }
                    Button(onClick = onRequestRide, enabled = ui.quote != null && ui.auth.authenticated) {
                        Text("Request ride")
                    }
                }
            }
        }

        item {
            ui.quote?.let { quote ->
                SectionCard(
                    title = "Live quote",
                    subtitle = "${quote.origin.label} to ${quote.destination.label}"
                ) {
                    Text("Distance: ${(quote.distanceMeters / 1000.0).toString().take(4)} km")
                    Text("ETA: ${quote.durationSeconds / 60} mins")
                    Text("Selected fare: ${formatCurrency(quote.selectedFareUgx)}")
                    MapCard(quote = quote, ride = null)
                }
            } ?: SectionCard(
                title = "Route preview",
                subtitle = "Choose pickup and destination to see estimates."
            ) {
                val activeRide = ui.dashboard.rides.firstOrNull { it.status in listOf("assigned", "accepted", "in_progress") }
                MapCard(quote = null, ride = activeRide)
            }
        }
    }
}

@Composable
private fun SuggestionList(
    suggestions: List<PlaceSuggestion>,
    onSelected: (PlaceSuggestion) -> Unit
) {
    Column {
        suggestions.take(4).forEach { suggestion ->
            TextButton(onClick = { onSelected(suggestion) }) {
                Text(suggestion.address, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun TripsTab(
    rides: List<RideSnapshot>,
    selectedRideId: String?,
    onSelectRide: (String) -> Unit
) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (rides.isEmpty()) {
            item {
                SectionCard("Your rides", "No rides yet.") { Text("Pick a route and request your first trip.") }
            }
        } else {
            items(rides) { ride ->
                SectionCard(
                    title = "${ride.originLabel} -> ${ride.destinationLabel}",
                    subtitle = formatDateTime(ride.requestedAt)
                ) {
                    StatusChip(formatStatus(ride.status))
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Fare: ${formatCurrency(ride.finalFareUgx ?: ride.quotedFareUgx)}")
                    Text("Vehicle: ${formatStatus(ride.requestedVehicleClass)}")
                    Text(
                        if (ride.driverName.isNullOrBlank()) "No driver assigned yet"
                        else "Driver: ${ride.driverName} (${ride.driverPlateNumber ?: ride.driverVehicle.orEmpty()})"
                    )
                    Button(
                        onClick = { onSelectRide(ride.id) },
                        modifier = Modifier.padding(top = 8.dp)
                    ) {
                        Text(if (selectedRideId == ride.id) "Opened" else "Open trip")
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatTab(ui: CustomerUiState, onSend: (String) -> Unit) {
    var draft by remember(ui.selectedRideId) { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SectionCard(
            title = if (ui.selectedRideId == null) "Ride chat" else "Ride ${ui.selectedRideId.take(8)}",
            subtitle = "Coordinate pickup with the assigned driver."
        ) {
            if (ui.selectedRideId == null) {
                Text("Open a ride from the Trips tab first.")
            } else if (ui.messages.isEmpty()) {
                Text("No messages yet for this ride.")
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    ui.messages.forEach { message ->
                        Card {
                            Column(Modifier.padding(12.dp)) {
                                Text(if (message.senderRole == "customer") "You" else "Driver")
                                Text(message.body)
                                Text(formatDateTime(message.createdAt), style = MaterialTheme.typography.bodySmall)
                            }
                        }
                    }
                }
            }
            Spacer(modifier = Modifier.height(12.dp))
            OutlinedTextField(
                value = draft,
                onValueChange = { draft = it },
                label = { Text("Message") },
                modifier = Modifier.fillMaxWidth()
            )
            Button(
                onClick = {
                    onSend(draft)
                    draft = ""
                },
                enabled = ui.selectedRideId != null && draft.isNotBlank(),
                modifier = Modifier.padding(top = 8.dp)
            ) {
                Text("Send")
            }
        }
    }
}

@Composable
private fun AlertsTab(notifications: List<NotificationItem>, onRead: (String) -> Unit) {
    LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (notifications.isEmpty()) {
            item { SectionCard("Dispatch updates", "No notifications yet.") { Text("Updates will appear here.") } }
        } else {
            items(notifications) { notification ->
                SectionCard(notification.title, notification.message) {
                    Text(formatDateTime(notification.createdAt))
                    if (notification.readAt == null) {
                        TextButton(onClick = { onRead(notification.id) }) {
                            Text("Mark read")
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MapCard(quote: RouteQuote?, ride: RideSnapshot?) {
    val defaultCenter = LatLng(0.3136, 32.5811)
    val cameraPositionState = rememberCameraPositionState {
        position = CameraPosition.fromLatLngZoom(defaultCenter, 12f)
    }

    val polylinePoints = when {
        quote?.encodedPolyline != null -> decodePolyline(quote.encodedPolyline)
        else -> emptyList()
    }

    LaunchedEffect(quote, ride) {
        val boundsBuilder = LatLngBounds.builder()
        var hasPoint = false
        fun addPoint(lat: Double?, lng: Double?) {
            if (lat != null && lng != null) {
                boundsBuilder.include(LatLng(lat, lng))
                hasPoint = true
            }
        }

        quote?.let {
            addPoint(it.origin.lat, it.origin.lng)
            addPoint(it.destination.lat, it.destination.lng)
        }
        ride?.let {
            addPoint(it.originLat, it.originLng)
            addPoint(it.destinationLat, it.destinationLng)
            addPoint(it.currentLat ?: it.driverCurrentLat, it.currentLng ?: it.driverCurrentLng)
        }

        if (hasPoint) {
            runCatching { cameraPositionState.move(com.google.android.gms.maps.CameraUpdateFactory.newLatLngBounds(boundsBuilder.build(), 120)) }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(260.dp)
    ) {
        GoogleMap(
            modifier = Modifier.fillMaxSize(),
            cameraPositionState = cameraPositionState,
            properties = MapProperties(isMyLocationEnabled = false)
        ) {
            quote?.let {
                Marker(MarkerState(LatLng(it.origin.lat, it.origin.lng)), title = "Pickup", snippet = it.origin.label)
                Marker(MarkerState(LatLng(it.destination.lat, it.destination.lng)), title = "Destination", snippet = it.destination.label)
                if (polylinePoints.isNotEmpty()) {
                    Polyline(points = polylinePoints)
                }
            }
            ride?.let {
                if (it.originLat != null && it.originLng != null) {
                    Marker(MarkerState(LatLng(it.originLat, it.originLng)), title = "Pickup", snippet = it.originLabel)
                }
                if (it.destinationLat != null && it.destinationLng != null) {
                    Marker(MarkerState(LatLng(it.destinationLat, it.destinationLng)), title = "Destination", snippet = it.destinationLabel)
                }
                val driverLat = it.currentLat ?: it.driverCurrentLat
                val driverLng = it.currentLng ?: it.driverCurrentLng
                if (driverLat != null && driverLng != null) {
                    Marker(MarkerState(LatLng(driverLat, driverLng)), title = "Driver", snippet = it.driverName ?: "Assigned driver")
                }
            }
        }
    }
}

private fun launchGoogleSignIn(
    activity: Activity,
    clientId: String,
    viewModel: CustomerViewModel
) {
    if (clientId.isBlank()) return
    val credentialManager = CredentialManager.create(activity)
    val googleIdOption = GetGoogleIdOption.Builder()
        .setFilterByAuthorizedAccounts(false)
        .setServerClientId(clientId)
        .setAutoSelectEnabled(false)
        .build()
    val request = GetCredentialRequest.Builder()
        .addCredentialOption(googleIdOption)
        .build()

    (activity as ComponentActivity).lifecycleScope.launchWhenStarted {
        runCatching {
            val result = credentialManager.getCredential(activity, request)
            val credential = GoogleIdTokenCredential.createFrom(result.credential.data)
            viewModel.signInWithGoogleToken(credential.idToken)
        }
    }
}

private fun requestCurrentLocation(
    context: android.content.Context,
    viewModel: CustomerViewModel
) {
    val fused = LocationServices.getFusedLocationProviderClient(context)
    (context as ComponentActivity).lifecycleScope.launchWhenStarted {
        runCatching {
            val location = fused.lastLocation.await()
            if (location != null) {
                val address = Geocoder(context, Locale.getDefault()).getFromLocation(location.latitude, location.longitude, 1)
                    ?.firstOrNull()
                    ?.getAddressLine(0)
                    ?: "Current location"
                viewModel.useCurrentLocation(location.latitude, location.longitude, address)
            }
        }
    }
}
