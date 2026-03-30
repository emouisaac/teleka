package com.teleka.core.network

import android.content.Context
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

class PersistentCookieJar(
    context: Context,
    private val gson: Gson
) : CookieJar {

    private val prefs = context.getSharedPreferences("teleka_cookie_store", Context.MODE_PRIVATE)
    private val cache = mutableMapOf<String, MutableList<Cookie>>()

    init {
        restore()
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val host = url.host
        val bucket = cache.getOrPut(host) { mutableListOf() }
        cookies.forEach { incoming ->
            bucket.removeAll { it.name == incoming.name && it.domain == incoming.domain && it.path == incoming.path }
            if (incoming.expiresAt > System.currentTimeMillis()) {
                bucket += incoming
            }
        }
        persist()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        val result = mutableListOf<Cookie>()
        cache.values.forEach { cookies ->
            cookies.removeAll { it.expiresAt <= now }
            result += cookies.filter { it.matches(url) }
        }
        persist()
        return result
    }

    fun cookieHeader(baseUrl: String): String {
        val url = HttpUrl.get(baseUrl)
        return loadForRequest(url).joinToString("; ") { "${it.name}=${it.value}" }
    }

    fun clear() {
        cache.clear()
        prefs.edit().remove(KEY).apply()
    }

    private fun persist() {
        val flattened = cache.mapValues { (_, cookies) ->
            cookies.map {
                StoredCookie(
                    name = it.name,
                    value = it.value,
                    expiresAt = it.expiresAt,
                    domain = it.domain,
                    path = it.path,
                    secure = it.secure,
                    httpOnly = it.httpOnly,
                    hostOnly = it.hostOnly
                )
            }
        }
        prefs.edit().putString(KEY, gson.toJson(flattened)).apply()
    }

    private fun restore() {
        val raw = prefs.getString(KEY, null) ?: return
        val type = object : TypeToken<Map<String, List<StoredCookie>>>() {}.type
        val decoded: Map<String, List<StoredCookie>> = gson.fromJson(raw, type) ?: return
        decoded.forEach { (host, values) ->
            cache[host] = values.mapNotNull { it.toOkHttpCookie() }.toMutableList()
        }
    }

    private data class StoredCookie(
        val name: String,
        val value: String,
        val expiresAt: Long,
        val domain: String,
        val path: String,
        val secure: Boolean,
        val httpOnly: Boolean,
        val hostOnly: Boolean
    ) {
        fun toOkHttpCookie(): Cookie? = runCatching {
            Cookie.Builder()
                .name(name)
                .value(value)
                .apply {
                    if (hostOnly) hostOnlyDomain(domain) else domain(domain)
                    path(path)
                    expiresAt(expiresAt)
                    if (secure) secure()
                    if (httpOnly) httpOnly()
                }
                .build()
        }.getOrNull()
    }

    private companion object {
        const val KEY = "cookies"
    }
}
