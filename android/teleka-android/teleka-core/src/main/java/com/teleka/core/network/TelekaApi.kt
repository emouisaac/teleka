package com.teleka.core.network

import com.teleka.core.data.AdminDashboardResponse
import com.teleka.core.data.AdminLoginRequest
import com.teleka.core.data.AssignRideRequest
import com.teleka.core.data.AuthStatusResponse
import com.teleka.core.data.AvailabilityRequest
import com.teleka.core.data.CompleteRideRequest
import com.teleka.core.data.CreateRideRequest
import com.teleka.core.data.CustomerDashboardResponse
import com.teleka.core.data.DriverDashboardResponse
import com.teleka.core.data.DriverDocumentsResponse
import com.teleka.core.data.DriverLocationRequest
import com.teleka.core.data.DriverLoginRequest
import com.teleka.core.data.FareSettingsRequest
import com.teleka.core.data.GoogleCredentialRequest
import com.teleka.core.data.MessagesResponse
import com.teleka.core.data.NotesRequest
import com.teleka.core.data.NotificationsResponse
import com.teleka.core.data.PlacesResponse
import com.teleka.core.data.PublicConfigResponse
import com.teleka.core.data.PublicSettingsResponse
import com.teleka.core.data.RideEnvelope
import com.teleka.core.data.RideMessageRequest
import com.teleka.core.data.RideStatusRequest
import com.teleka.core.data.SuccessResponse
import okhttp3.MultipartBody
import okhttp3.RequestBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

interface TelekaApi {
    @GET("api/auth/status")
    suspend fun authStatus(): AuthStatusResponse

    @POST("api/auth/keepalive")
    suspend fun keepAlive(): SuccessResponse

    @POST("api/auth/logout")
    suspend fun logout(): SuccessResponse

    @GET("api/auth/notifications")
    suspend fun notifications(): NotificationsResponse

    @POST("api/auth/notifications/{id}/read")
    suspend fun markNotificationRead(@Path("id") id: String): SuccessResponse

    @POST("api/auth/admin/login")
    suspend fun adminLogin(@Body body: AdminLoginRequest): AuthStatusResponse

    @POST("api/auth/google")
    suspend fun googleLogin(@Body body: GoogleCredentialRequest): AuthStatusResponse

    @POST("api/auth/driver/login")
    suspend fun driverLogin(@Body body: DriverLoginRequest): AuthStatusResponse

    @Multipart
    @POST("api/auth/driver/register")
    suspend fun registerDriver(
        @Part("fullName") fullName: RequestBody,
        @Part("email") email: RequestBody,
        @Part("phone") phone: RequestBody,
        @Part("password") password: RequestBody,
        @Part("vehicle") vehicle: RequestBody,
        @Part("plateNumber") plateNumber: RequestBody,
        @Part("licenseNumber") licenseNumber: RequestBody,
        @Part("nationalIdNumber") nationalIdNumber: RequestBody,
        @Part("insuranceNumber") insuranceNumber: RequestBody,
        @Part facePhoto: MultipartBody.Part,
        @Part carPhoto: MultipartBody.Part?,
        @Part documents: List<MultipartBody.Part>
    ): SuccessResponse

    @GET("api/public/config")
    suspend fun publicConfig(): PublicConfigResponse

    @GET("api/public/settings")
    suspend fun publicSettings(): PublicSettingsResponse

    @GET("api/public/places/autocomplete")
    suspend fun autocompletePlaces(@Query("q") query: String): PlacesResponse

    @GET("api/customer/dashboard")
    suspend fun customerDashboard(): CustomerDashboardResponse

    @POST("api/customer/rides")
    suspend fun createRide(@Body body: CreateRideRequest): RideEnvelope

    @GET("api/customer/rides/{rideId}/messages")
    suspend fun customerMessages(@Path("rideId") rideId: String): MessagesResponse

    @POST("api/customer/rides/{rideId}/messages")
    suspend fun customerSendMessage(
        @Path("rideId") rideId: String,
        @Body body: RideMessageRequest
    ): MessagesResponse

    @GET("api/admin/dashboard")
    suspend fun adminDashboard(): AdminDashboardResponse

    @POST("api/admin/drivers/{driverId}/approve")
    suspend fun approveDriver(
        @Path("driverId") driverId: String,
        @Body body: NotesRequest
    ): SuccessResponse

    @POST("api/admin/drivers/{driverId}/reject")
    suspend fun rejectDriver(
        @Path("driverId") driverId: String,
        @Body body: NotesRequest
    ): SuccessResponse

    @GET("api/admin/drivers/{driverId}/documents")
    suspend fun driverDocuments(@Path("driverId") driverId: String): DriverDocumentsResponse

    @POST("api/admin/rides/{rideId}/assign")
    suspend fun assignRide(
        @Path("rideId") rideId: String,
        @Body body: AssignRideRequest
    ): RideEnvelope

    @POST("api/admin/rides/{rideId}/status")
    suspend fun updateRideStatus(
        @Path("rideId") rideId: String,
        @Body body: RideStatusRequest
    ): RideEnvelope

    @PUT("api/admin/settings/fare")
    suspend fun saveFareSettings(@Body body: FareSettingsRequest): PublicSettingsResponse

    @GET("api/driver/dashboard")
    suspend fun driverDashboard(): DriverDashboardResponse

    @POST("api/driver/availability")
    suspend fun updateAvailability(@Body body: AvailabilityRequest): SuccessResponse

    @POST("api/driver/location")
    suspend fun publishLocation(@Body body: DriverLocationRequest): SuccessResponse

    @POST("api/driver/rides/{rideId}/accept")
    suspend fun acceptRide(@Path("rideId") rideId: String): RideEnvelope

    @POST("api/driver/rides/{rideId}/reject")
    suspend fun rejectRide(@Path("rideId") rideId: String): RideEnvelope

    @POST("api/driver/rides/{rideId}/start")
    suspend fun startRide(@Path("rideId") rideId: String): RideEnvelope

    @POST("api/driver/rides/{rideId}/complete")
    suspend fun completeRide(
        @Path("rideId") rideId: String,
        @Body body: CompleteRideRequest
    ): RideEnvelope

    @GET("api/driver/rides/{rideId}/messages")
    suspend fun driverMessages(@Path("rideId") rideId: String): MessagesResponse

    @POST("api/driver/rides/{rideId}/messages")
    suspend fun driverSendMessage(
        @Path("rideId") rideId: String,
        @Body body: RideMessageRequest
    ): MessagesResponse
}
