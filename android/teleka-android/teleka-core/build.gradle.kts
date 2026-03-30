plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.teleka.core"
    compileSdk = 35

    defaultConfig {
        minSdk = 26
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.14"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.09.03")

    api(composeBom)
    api("androidx.compose.ui:ui")
    api("androidx.compose.material3:material3")
    api("androidx.compose.material:material-icons-extended")
    api("androidx.compose.ui:ui-tooling-preview")
    api("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    api("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    api("androidx.navigation:navigation-compose:2.8.2")
    api("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    api("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")
    api("com.google.code.gson:gson:2.11.0")
    api("com.squareup.retrofit2:retrofit:2.11.0")
    api("com.squareup.retrofit2:converter-gson:2.11.0")
    api("com.squareup.okhttp3:okhttp:4.12.0")
    api("com.squareup.okhttp3:logging-interceptor:4.12.0")
    api("io.coil-kt:coil-compose:2.7.0")
    api("com.google.maps.android:maps-compose:6.2.1")
    api("com.google.android.gms:play-services-maps:19.0.0")
    api("com.google.android.gms:play-services-location:21.3.0")
    api("io.socket:socket.io-client:2.1.1") {
        exclude(group = "org.json", module = "json")
    }
}
