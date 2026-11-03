import java.util.Properties

val localProperties = Properties().apply {
    val propertiesFile = rootProject.file("local.properties")
    if (propertiesFile.exists()) {
        propertiesFile.inputStream().use(::load)
    }
}
// No computador do desenvolvedor a chave vem de local.properties. No GitHub Actions,
// ela vem do Secret SUPABASE_PUBLISHABLE_KEY e nunca é gravada no repositório.
val supabasePublishableKey = localProperties.getProperty("SUPABASE_PUBLISHABLE_KEY")
    ?: providers.environmentVariable("SUPABASE_PUBLISHABLE_KEY").orNull.orEmpty()
val configuredVersionCode = providers.gradleProperty("versionCode").orNull?.toIntOrNull() ?: 16
val configuredVersionName = providers.gradleProperty("versionName").orNull ?: "2.3.3-android14plus"
val releaseStoreFile = providers.environmentVariable("ANDROID_KEYSTORE_FILE").orNull
val releaseStorePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").orNull
val releaseKeyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").orNull
val releaseKeyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").orNull
val hasReleaseSigning = listOf(
    releaseStoreFile,
    releaseStorePassword,
    releaseKeyAlias,
    releaseKeyPassword,
).all { !it.isNullOrBlank() }

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
        versionCode = configuredVersionCode
        versionName = configuredVersionName
        buildConfigField(
            "String",
            "SUPABASE_FUNCTIONS_URL",
            "\"https://tfuiwogiwbvqxfqktnwe.supabase.co/functions/v1\""
        )
        buildConfigField(
            "String",
            "SUPABASE_PUBLISHABLE_KEY",
            "\"$supabasePublishableKey\""
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

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = rootProject.file(releaseStoreFile!!)
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        getByName("release") {
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("release")
        }
    }

}

dependencies {
    // Ktor Client para requisições HTTP
    implementation("io.ktor:ktor-client-core:2.3.7")
    implementation("io.ktor:ktor-client-android:2.3.7")
    implementation("io.ktor:ktor-client-content-negotiation:2.3.7")
    implementation("io.ktor:ktor-serialization-kotlinx-json:2.3.7")
    // Necessário para Dispatchers.Main nas coroutines usadas pela Activity.
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Kotlinx Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.0")
    implementation("androidx.security:security-crypto:1.1.0-alpha06")
    implementation("androidx.webkit:webkit:1.12.1")

    testImplementation("junit:junit:4.13.2")

    // A autenticação Supabase é chamada pela API REST em SupabaseAuthService.
    // Portanto, não é necessário incluir o SDK auth-kt aqui. Manter a dependência
    // sem uma versão fazia o Gradle falhar durante a resolução do APK.
}
