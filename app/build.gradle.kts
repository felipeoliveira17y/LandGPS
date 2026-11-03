plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    kotlin("plugin.serialization") version "2.0.21"
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
        buildConfigField(
            "String",
            "SUPABASE_FUNCTIONS_URL",
            "\"https://tfuiwogiwbvqxfqktnwe.supabase.co/functions/v1\""
        )
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }

}

dependencies {
    // Ktor Client para requisições HTTP
    implementation("io.ktor:ktor-client-core:2.3.7")
    implementation("io.ktor:ktor-client-android:2.3.7")
    implementation("io.ktor:ktor-client-content-negotiation:2.3.7")
    implementation("io.ktor:ktor-serialization-kotlinx-json:2.3.7")

    // Kotlinx Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0")

    // Supabase Auth
    implementation(platform("io.github.jan-tennert.supabase:bom:2.4.0"))
    implementation("io.github.jan-tennert.supabase:auth-kt")
}
