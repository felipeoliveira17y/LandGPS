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

    testImplementation("junit:junit:4.13.2")

    // A autenticação Supabase é chamada pela API REST em SupabaseAuthService.
    // Portanto, não é necessário incluir o SDK auth-kt aqui. Manter a dependência
    // sem uma versão fazia o Gradle falhar durante a resolução do APK.
}
