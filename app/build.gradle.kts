plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.landmensure.gps"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.landmensure.gps"
        minSdk = 34
        targetSdk = 36
        versionCode = 15
        versionName = "2.3.2-android14plus"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}
