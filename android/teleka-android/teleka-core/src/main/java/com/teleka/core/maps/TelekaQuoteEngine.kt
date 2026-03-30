package com.teleka.core.maps

import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import com.teleka.core.data.FareSettings
import com.teleka.core.data.PlaceSuggestion
import com.teleka.core.data.QuotePlace
import com.teleka.core.data.RouteQuote
import com.teleka.core.data.VehicleEstimate
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

class TelekaQuoteEngine(
    private val okHttpClient: OkHttpClient,
    private val gson: Gson
) {
    suspend fun buildQuote(
        origin: PlaceSuggestion,
        destination: PlaceSuggestion,
        fareSettings: FareSettings,
        selectedVehicleClass: String,
        mapsApiKey: String
    ): RouteQuote {
        val resolvedOrigin = resolvePlace(origin, mapsApiKey)
        val resolvedDestination = resolvePlace(destination, mapsApiKey)
        val route = computeRoute(resolvedOrigin, resolvedDestination, mapsApiKey)
        val estimates = buildVehicleEstimates(route.distanceMeters, route.durationSeconds, fareSettings)
        val selected = estimates.firstOrNull { it.key == selectedVehicleClass }
            ?: estimates.firstOrNull { it.key == "standard" }
            ?: estimates.first()

        return RouteQuote(
            origin = resolvedOrigin,
            destination = resolvedDestination,
            distanceMeters = route.distanceMeters,
            durationSeconds = route.durationSeconds,
            selectedVehicleClass = selected.key,
            selectedFareUgx = selected.fareUgx,
            estimates = estimates,
            encodedPolyline = route.encodedPolyline
        )
    }

    private fun resolvePlace(place: PlaceSuggestion, apiKey: String): QuotePlace {
        if (place.lat != null && place.lng != null) {
            return QuotePlace(
                label = place.label.ifBlank { place.address },
                address = place.address,
                placeId = place.placeId,
                lat = place.lat,
                lng = place.lng
            )
        }

        val url = buildString {
            append("https://maps.googleapis.com/maps/api/geocode/json?")
            if (!place.placeId.isNullOrBlank()) {
                append("place_id=").append(place.placeId)
            } else {
                append("address=").append(place.address.replace(" ", "%20"))
            }
            append("&key=").append(apiKey)
        }

        val request = Request.Builder().url(url).get().build()
        okHttpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("Unable to geocode ${place.label}")
            val payload = gson.fromJson(response.body?.charStream(), GeocodeResponse::class.java)
            val result = payload.results.firstOrNull() ?: error("Unable to geocode ${place.label}")
            return QuotePlace(
                label = place.label.ifBlank { result.formattedAddress },
                address = result.formattedAddress,
                placeId = result.placeId.ifBlank { place.placeId.orEmpty() },
                lat = result.geometry.location.lat,
                lng = result.geometry.location.lng
            )
        }
    }

    private fun computeRoute(origin: QuotePlace, destination: QuotePlace, apiKey: String): ComputedRoute {
        val body = gson.toJson(
            mapOf(
                "origin" to mapOf(
                    "location" to mapOf("latLng" to mapOf("latitude" to origin.lat, "longitude" to origin.lng))
                ),
                "destination" to mapOf(
                    "location" to mapOf("latLng" to mapOf("latitude" to destination.lat, "longitude" to destination.lng))
                ),
                "travelMode" to "DRIVE",
                "routingPreference" to "TRAFFIC_AWARE",
                "languageCode" to "en-UG",
                "units" to "METRIC"
            )
        ).toRequestBody("application/json".toMediaType())

        val request = Request.Builder()
            .url("https://routes.googleapis.com/directions/v2:computeRoutes")
            .header(
                "X-Goog-FieldMask",
                "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline"
            )
            .header("X-Goog-Api-Key", apiKey)
            .post(body)
            .build()

        okHttpClient.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("Unable to calculate route")
            val payload = gson.fromJson(response.body?.charStream(), RoutesResponse::class.java)
            val route = payload.routes.firstOrNull() ?: error("Unable to calculate route")
            return ComputedRoute(
                distanceMeters = route.distanceMeters,
                durationSeconds = route.duration.removeSuffix("s").toIntOrNull() ?: 0,
                encodedPolyline = route.polyline?.encodedPolyline
            )
        }
    }

    private fun buildVehicleEstimates(
        distanceMeters: Int,
        durationSeconds: Int,
        fareSettings: FareSettings
    ): List<VehicleEstimate> {
        val standardFare = calculateFare(distanceMeters, durationSeconds, fareSettings)
        val classes = listOf(
            VehicleClass("mini", "Teleka Mini", 0.84, 0.9),
            VehicleClass("standard", "Standard", 1.0, 1.0),
            VehicleClass("premium", "Premium", 1.55, 1.45),
            VehicleClass("suv", "SUV", 1.34, 1.25)
        )

        return classes.map { item ->
            VehicleEstimate(
                key = item.key,
                label = item.label,
                fareUgx = maxOf(
                    (fareSettings.minimumFareUgx * item.minimumMultiplier).toInt(),
                    (standardFare * item.fareMultiplier).toInt()
                )
            )
        }
    }

    private fun calculateFare(
        distanceMeters: Int,
        durationSeconds: Int,
        fareSettings: FareSettings
    ): Int {
        val distanceKm = distanceMeters / 1000.0
        val durationMinutes = durationSeconds / 60.0
        val rawFare = fareSettings.baseFareUgx +
            fareSettings.bookingFeeUgx +
            distanceKm * fareSettings.perKmUgx +
            durationMinutes * fareSettings.perMinuteUgx
        return maxOf(fareSettings.minimumFareUgx, rawFare.toInt())
    }

    private data class VehicleClass(
        val key: String,
        val label: String,
        val fareMultiplier: Double,
        val minimumMultiplier: Double
    )

    private data class ComputedRoute(
        val distanceMeters: Int,
        val durationSeconds: Int,
        val encodedPolyline: String?
    )

    private data class GeocodeResponse(val results: List<GeocodeResult> = emptyList())
    private data class GeocodeResult(
        @SerializedName("formatted_address") val formattedAddress: String,
        @SerializedName("place_id") val placeId: String,
        val geometry: Geometry
    )

    private data class Geometry(val location: LatLngHolder)
    private data class LatLngHolder(val lat: Double, val lng: Double)
    private data class RoutesResponse(val routes: List<RouteResult> = emptyList())
    private data class RouteResult(
        val distanceMeters: Int,
        val duration: String,
        val polyline: PolylineHolder?
    )

    private data class PolylineHolder(val encodedPolyline: String?)
}
