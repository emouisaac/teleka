package com.teleka.core.network

import android.content.Context
import com.google.gson.Gson
import com.teleka.core.data.AuthStatusResponse
import com.teleka.core.data.CreateRideRequest
import com.teleka.core.data.CustomerDashboardResponse
import com.teleka.core.data.DriverDocumentsResponse
import com.teleka.core.data.DriverRegistrationForm
import com.teleka.core.data.FareSettings
import com.teleka.core.data.GoogleCredentialRequest
import com.teleka.core.data.MessagesResponse
import com.teleka.core.data.PlaceSuggestion
import com.teleka.core.data.PublicConfigResponse
import com.teleka.core.data.PublicSettingsResponse
import com.teleka.core.data.RouteQuote
import com.teleka.core.data.UploadItem
import com.teleka.core.maps.TelekaQuoteEngine
import com.teleka.core.util.asMultipart
import com.teleka.core.util.asPlainBody
import java.util.concurrent.TimeUnit
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory

class TelekaRepository(
    context: Context,
    baseUrl: String
) {
    private val gson = Gson()
    private val cookieJar = PersistentCookieJar(context, gson)
    private val okHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(
            HttpLoggingInterceptor().apply {
                level = HttpLoggingInterceptor.Level.BASIC
            }
        )
        .build()

    private val api = Retrofit.Builder()
        .baseUrl(baseUrl.ensureTrailingSlash())
        .client(okHttpClient)
        .addConverterFactory(GsonConverterFactory.create(gson))
        .build()
        .create(TelekaApi::class.java)

    private val quoteEngine = TelekaQuoteEngine(okHttpClient, gson)
    private val resolvedBaseUrl = baseUrl.ensureTrailingSlash()

    fun createSocketClient(): TelekaSocketClient = TelekaSocketClient(resolvedBaseUrl, cookieJar, gson)

    suspend fun authStatus(): AuthStatusResponse = api.authStatus()
    suspend fun keepAlive() = api.keepAlive()
    suspend fun logout() = api.logout().also { cookieJar.clear() }
    suspend fun notifications() = api.notifications()
    suspend fun markNotificationRead(id: String) = api.markNotificationRead(id)
    suspend fun publicConfig(): PublicConfigResponse = api.publicConfig()
    suspend fun publicSettings(): PublicSettingsResponse = api.publicSettings()
    suspend fun autocompletePlaces(query: String) = api.autocompletePlaces(query)
    suspend fun googleLogin(credential: String) = api.googleLogin(GoogleCredentialRequest(credential))
    suspend fun adminLogin(email: String, password: String) = api.adminLogin(com.teleka.core.data.AdminLoginRequest(email, password))
    suspend fun driverLogin(email: String, password: String) = api.driverLogin(com.teleka.core.data.DriverLoginRequest(email, password))
    suspend fun customerDashboard(): CustomerDashboardResponse = api.customerDashboard()
    suspend fun createRide(body: CreateRideRequest) = api.createRide(body)
    suspend fun customerMessages(rideId: String): MessagesResponse = api.customerMessages(rideId)
    suspend fun customerSendMessage(rideId: String, body: String) = api.customerSendMessage(rideId, com.teleka.core.data.RideMessageRequest(body))
    suspend fun adminDashboard() = api.adminDashboard()
    suspend fun approveDriver(driverId: String, notes: String?) = api.approveDriver(driverId, com.teleka.core.data.NotesRequest(notes))
    suspend fun rejectDriver(driverId: String, notes: String?) = api.rejectDriver(driverId, com.teleka.core.data.NotesRequest(notes))
    suspend fun driverDocuments(driverId: String): DriverDocumentsResponse = api.driverDocuments(driverId)
    suspend fun assignRide(rideId: String, driverId: String) = api.assignRide(rideId, com.teleka.core.data.AssignRideRequest(driverId))
    suspend fun cancelRide(rideId: String) = api.updateRideStatus(rideId, com.teleka.core.data.RideStatusRequest("cancelled"))
    suspend fun saveFareSettings(fare: FareSettings) = api.saveFareSettings(
        com.teleka.core.data.FareSettingsRequest(
            fare.baseFareUgx,
            fare.bookingFeeUgx,
            fare.perKmUgx,
            fare.perMinuteUgx,
            fare.minimumFareUgx
        )
    )
    suspend fun driverDashboard() = api.driverDashboard()
    suspend fun updateAvailability(isOnline: Boolean) = api.updateAvailability(com.teleka.core.data.AvailabilityRequest(isOnline))
    suspend fun publishLocation(lat: Double, lng: Double, heading: Double = 0.0) =
        api.publishLocation(com.teleka.core.data.DriverLocationRequest(lat, lng, heading))
    suspend fun acceptRide(rideId: String) = api.acceptRide(rideId)
    suspend fun rejectRide(rideId: String) = api.rejectRide(rideId)
    suspend fun startRide(rideId: String) = api.startRide(rideId)
    suspend fun completeRide(rideId: String, finalFareUgx: Int) =
        api.completeRide(rideId, com.teleka.core.data.CompleteRideRequest(finalFareUgx))
    suspend fun driverMessages(rideId: String) = api.driverMessages(rideId)
    suspend fun driverSendMessage(rideId: String, body: String) =
        api.driverSendMessage(rideId, com.teleka.core.data.RideMessageRequest(body))

    suspend fun registerDriver(
        context: Context,
        form: DriverRegistrationForm,
        facePhotoBytes: ByteArray,
        carPhoto: UploadItem?,
        documents: List<UploadItem>
    ) = api.registerDriver(
        fullName = form.fullName.asPlainBody(),
        email = form.email.asPlainBody(),
        phone = form.phone.asPlainBody(),
        password = form.password.asPlainBody(),
        vehicle = form.vehicle.asPlainBody(),
        plateNumber = form.plateNumber.asPlainBody(),
        licenseNumber = form.licenseNumber.asPlainBody(),
        nationalIdNumber = form.nationalIdNumber.asPlainBody(),
        insuranceNumber = form.insuranceNumber.asPlainBody(),
        facePhoto = facePhotoBytes.asMultipart("facePhoto", "face-capture.jpg"),
        carPhoto = carPhoto?.uri?.asMultipart(context, "carPhoto", carPhoto.displayName),
        documents = documents.mapNotNull { item ->
            item.uri.asMultipart(context, "documents", item.displayName)
        }
    )

    suspend fun buildQuote(
        origin: PlaceSuggestion,
        destination: PlaceSuggestion,
        fareSettings: FareSettings,
        selectedVehicleClass: String,
        mapsApiKey: String
    ): RouteQuote = quoteEngine.buildQuote(origin, destination, fareSettings, selectedVehicleClass, mapsApiKey)
}

private fun String.ensureTrailingSlash(): String = if (endsWith("/")) this else "$this/"
