import java.util.Properties
import java.net.URI

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
val configuredVersionCode = providers.gradleProperty("versionCode").orNull?.let {
    it.toIntOrNull()?.takeIf { code -> code in 1..2_100_000_000 }
        ?: error("versionCode precisa ser um inteiro positivo aceito pela Google Play.")
} ?: 17
val configuredVersionName = providers.gradleProperty("versionName").orNull ?: "2.4.0"
val publicWebUrl = (providers.gradleProperty("publicWebUrl").orNull
    ?: providers.environmentVariable("LANDMENSURE_PUBLIC_WEB_URL").orNull
    ?: localProperties.getProperty("LANDMENSURE_PUBLIC_WEB_URL")).orEmpty().trimEnd('/')
if (publicWebUrl.isNotEmpty()) {
    val uri = URI(publicWebUrl)
    require(uri.scheme == "https" && uri.host != null && uri.userInfo == null &&
        uri.rawPath.isEmpty() && uri.rawQuery == null && uri.rawFragment == null
    ) { "Use a origem pública HTTPS do Landmensure, sem caminho, consulta ou fragmento." }
}
val keyProperties = Properties().apply {
    rootProject.file("keystore.properties").takeIf { it.isFile }?.inputStream()?.use(::load)
}
fun signingValue(env: String, property: String) =
    providers.environmentVariable(env).orNull ?: keyProperties.getProperty(property)
val releaseStoreFile = signingValue("ANDROID_KEYSTORE_FILE", "storeFile")
val releaseStorePassword = signingValue("ANDROID_KEYSTORE_PASSWORD", "storePassword")
val releaseKeyAlias = signingValue("ANDROID_KEY_ALIAS", "keyAlias")
val releaseKeyPassword = signingValue("ANDROID_KEY_PASSWORD", "keyPassword")
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
        buildConfigField("String", "PUBLIC_WEB_URL", "\"$publicWebUrl\"")
    }

    flavorDimensions += "distribution"
    productFlavors {
        create("playStore") {
            dimension = "distribution"
            buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"playStore\"")
            buildConfigField("boolean", "EXTERNAL_CHECKOUT_ENABLED", "false")
        }
        create("direct") {
            dimension = "distribution"
            buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"direct\"")
            buildConfigField("boolean", "EXTERNAL_CHECKOUT_ENABLED", "true")
        }
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
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

}

tasks.matching { it.name == "prePlayStoreReleaseBuild" }.configureEach {
    doFirst {
        require(!hasReleaseSigning || publicWebUrl.isNotEmpty()) {
            "Configure LANDMENSURE_PUBLIC_WEB_URL ou -PpublicWebUrl para publicar a versão Play Store."
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
