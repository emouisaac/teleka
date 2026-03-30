package com.teleka.core.network

import com.google.gson.Gson
import com.teleka.core.data.DriverProfile
import com.teleka.core.data.NotificationItem
import com.teleka.core.data.RideMessage
import com.teleka.core.data.RideSnapshot
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject

class TelekaSocketClient(
    private val baseUrl: String,
    private val cookieJar: PersistentCookieJar,
    private val gson: Gson
) {
    private var socket: Socket? = null

    fun connect(
        onNotification: (NotificationItem) -> Unit = {},
        onRideUpdated: (RideSnapshot) -> Unit = {},
        onDriverUpdated: (DriverProfile) -> Unit = {},
        onSettingsUpdated: (String?) -> Unit = {},
        onMessage: (RideMessage) -> Unit = {}
    ) {
        if (socket?.connected() == true) return

        val options = IO.Options.builder()
            .setReconnection(true)
            .setForceNew(true)
            .build()
            .apply {
                extraHeaders = mapOf(
                    "Cookie" to listOf(cookieJar.cookieHeader(baseUrl))
                )
            }

        socket = IO.socket(baseUrl.removeSuffix("/"), options).apply {
            on("notification:new") { args -> parse<NotificationItem>(args.firstOrNull())?.let(onNotification) }
            on("ride:updated") { args -> parse<RideSnapshot>(args.firstOrNull())?.let(onRideUpdated) }
            on("driver:updated") { args -> parse<DriverProfile>(args.firstOrNull())?.let(onDriverUpdated) }
            on("message:new") { args -> parse<RideMessage>(args.firstOrNull())?.let(onMessage) }
            on("settings:updated") { args ->
                val key = (args.firstOrNull() as? JSONObject)?.optString("key")
                onSettingsUpdated(key)
            }
            connect()
        }
    }

    fun disconnect() {
        socket?.disconnect()
        socket?.off()
        socket = null
    }

    fun watchRide(rideId: String?) {
        if (!rideId.isNullOrBlank()) socket?.emit("ride:watch", rideId)
    }

    fun unwatchRide(rideId: String?) {
        if (!rideId.isNullOrBlank()) socket?.emit("ride:unwatch", rideId)
    }

    private inline fun <reified T> parse(raw: Any?): T? {
        val json = when (raw) {
            is JSONObject -> raw.toString()
            is String -> raw
            else -> return null
        }
        return runCatching { gson.fromJson(json, T::class.java) }.getOrNull()
    }
}
