package com.teleka.core.util

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody

fun String.asPlainBody(): RequestBody = toRequestBody("text/plain".toMediaTypeOrNull())

fun ByteArray.asMultipart(partName: String, fileName: String): MultipartBody.Part {
    return MultipartBody.Part.createFormData(
        partName,
        fileName,
        toRequestBody("image/jpeg".toMediaTypeOrNull())
    )
}

fun Uri.asMultipart(context: Context, partName: String, fallbackName: String? = null): MultipartBody.Part? {
    val bytes = context.contentResolver.openInputStream(this)?.use { it.readBytes() } ?: return null
    val name = fallbackName ?: queryDisplayName(context) ?: "upload.bin"
    val type = context.contentResolver.getType(this).toMediaTypeOrNull() ?: "application/octet-stream".toMediaTypeOrNull()
    return MultipartBody.Part.createFormData(partName, name, bytes.toRequestBody(type))
}

fun Uri.queryDisplayName(context: Context): String? {
    return context.contentResolver.query(this, null, null, null, null)?.use { cursor ->
        val column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (column >= 0 && cursor.moveToFirst()) cursor.getString(column) else null
    }
}
