package com.teleka.core.util

import com.google.android.gms.maps.model.LatLng
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Currency
import java.util.Locale

private val ugxFormatter = NumberFormat.getCurrencyInstance(Locale("en", "UG")).apply {
    maximumFractionDigits = 0
    currency = Currency.getInstance("UGX")
}

private val dateFormatter = DateTimeFormatter.ofPattern("dd MMM yyyy, HH:mm")
    .withZone(ZoneId.systemDefault())

fun formatCurrency(amount: Int?): String = ugxFormatter.format(amount ?: 0)

fun formatDateTime(value: String?): String {
    if (value.isNullOrBlank()) return "Not yet"
    return runCatching { dateFormatter.format(Instant.parse(value)) }.getOrElse { value }
}

fun formatStatus(value: String?): String = value
    .orEmpty()
    .replace("_", " ")
    .split(" ")
    .filter { it.isNotBlank() }
    .joinToString(" ") { token -> token.replaceFirstChar { it.titlecase() } }
    .ifBlank { "Unknown" }

fun decodePolyline(encoded: String?): List<LatLng> {
    if (encoded.isNullOrBlank()) return emptyList()
    val poly = mutableListOf<LatLng>()
    var index = 0
    var lat = 0
    var lng = 0

    while (index < encoded.length) {
        var result = 1
        var shift = 0
        var b: Int
        do {
            b = encoded[index++].code - 63 - 1
            result += b shl shift
            shift += 5
        } while (b >= 0x1f)
        lat += if (result and 1 != 0) result.inv() shr 1 else result shr 1

        result = 1
        shift = 0
        do {
            b = encoded[index++].code - 63 - 1
            result += b shl shift
            shift += 5
        } while (b >= 0x1f)
        lng += if (result and 1 != 0) result.inv() shr 1 else result shr 1

        poly += LatLng(lat / 1E5, lng / 1E5)
    }

    return poly
}
