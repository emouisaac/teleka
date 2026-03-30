package com.teleka.core.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val TelekaLightColors = lightColorScheme(
    primary = Color(0xFF0E7969),
    onPrimary = Color.White,
    secondary = Color(0xFFEF9B28),
    onSecondary = Color(0xFF1F1300),
    tertiary = Color(0xFF8A4D18),
    background = Color(0xFFF5F3EC),
    onBackground = Color(0xFF1A1C1A),
    surface = Color(0xFFFFFBF5),
    onSurface = Color(0xFF1A1C1A),
    error = Color(0xFFB53A2D)
)

private val TelekaDarkColors = darkColorScheme(
    primary = Color(0xFF55C2B1),
    onPrimary = Color(0xFF003730),
    secondary = Color(0xFFF2BB6B),
    onSecondary = Color(0xFF442A00),
    tertiary = Color(0xFFE7A66D),
    background = Color(0xFF121514),
    onBackground = Color(0xFFE4E3DD),
    surface = Color(0xFF1A1D1C),
    onSurface = Color(0xFFE4E3DD),
    error = Color(0xFFFFB4A9)
)

@Composable
fun TelekaTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = if (darkTheme) TelekaDarkColors else TelekaLightColors,
        typography = MaterialTheme.typography,
        content = content
    )
}
