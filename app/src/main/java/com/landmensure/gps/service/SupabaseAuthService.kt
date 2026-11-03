package com.landmensure.gps.service

import android.content.Context
import android.net.Uri
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.landmensure.gps.BuildConfig
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.request.accept
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

data class AccountSession(val accessToken: String, val refreshToken: String, val email: String?)

sealed interface AuthResult {
    data class SignedIn(val email: String?) : AuthResult
    data object ConfirmationSent : AuthResult
    data object SignedOut : AuthResult
    data class RecoverySent(val email: String) : AuthResult
    data object RecoveryReady : AuthResult
    data object PasswordUpdated : AuthResult
    data class Failed(val message: String) : AuthResult
}

/**
 * Cliente de autenticação por e-mail para o Supabase.
 * A chave publishable é pública e identifica o aplicativo; a sessão do usuário
 * continua sendo necessária para qualquer operação autenticada.
 */
class SupabaseAuthService(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context,
        "landmensure_auth",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )
    private val json = Json { ignoreUnknownKeys = true }
    private val baseUrl = "https://tfuiwogiwbvqxfqktnwe.supabase.co/auth/v1"
    private val publishableKey = BuildConfig.SUPABASE_PUBLISHABLE_KEY

    fun currentSession(): AccountSession? {
        val accessToken = prefs.getString(KEY_ACCESS_TOKEN, null) ?: return null
        val refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null) ?: return null
        return AccountSession(accessToken, refreshToken, prefs.getString(KEY_EMAIL, null))
    }

    fun clearSession() {
        prefs.edit().clear().apply()
    }

    suspend fun signUp(email: String, password: String): AuthResult {
        if (!isConfigured()) return notConfigured()
        if (!isValidCredentials(email, password)) return AuthResult.Failed("Informe um e-mail válido e uma senha com pelo menos 8 caracteres.")
        return request("signup", buildJsonObject {
            put("email", email.trim())
            put("password", password)
            put("options", buildJsonObject {
                put("emailRedirectTo", AUTH_CALLBACK)
            })
        }) { root ->
            val session = root["session"]?.jsonObject
            if (session != null) {
                saveSession(session, email)
                AuthResult.SignedIn(email)
            } else {
                AuthResult.ConfirmationSent
            }
        }
    }

    suspend fun signIn(email: String, password: String): AuthResult {
        if (!isConfigured()) return notConfigured()
        if (!isValidCredentials(email, password)) return AuthResult.Failed("Informe seu e-mail e senha.")
        return request("token?grant_type=password", buildJsonObject {
            put("email", email.trim())
            put("password", password)
        }) { root ->
            saveSession(root, email)
            AuthResult.SignedIn(root["user"]?.jsonObject?.get("email")?.jsonPrimitive?.contentOrNull ?: email)
        }
    }

    suspend fun sendPasswordRecovery(email: String): AuthResult {
        if (!isConfigured()) return notConfigured()
        if (!android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches()) return AuthResult.Failed("Informe um e-mail válido.")
        return request("recover", buildJsonObject {
            put("email", email.trim())
            put("redirect_to", AUTH_CALLBACK)
        }) { AuthResult.RecoverySent(email.trim()) }
    }

    suspend fun updatePassword(password: String): AuthResult {
        val session = currentSession() ?: return AuthResult.Failed("Faça login novamente para alterar a senha.")
        if (password.length < 8) return AuthResult.Failed("A nova senha deve ter pelo menos 8 caracteres.")
        return request("user", buildJsonObject { put("password", password) }, session.accessToken, method = "PUT") {
            AuthResult.PasswordUpdated
        }
    }

    suspend fun signOut(): AuthResult {
        val session = currentSession()
        if (session != null && isConfigured()) {
            request("logout", buildJsonObject {}, session.accessToken)
        }
        clearSession()
        return AuthResult.SignedOut
    }

    fun importSessionFromDeepLink(uri: Uri): AuthResult? {
        if (uri.scheme != "gpslandmensure" || uri.host != "auth-callback") return null
        val values = linkedMapOf<String, String>()
        uri.queryParameterNames.forEach { key -> uri.getQueryParameter(key)?.let { values[key] = it } }
        uri.fragment?.split("&")?.forEach { pair ->
            val index = pair.indexOf('=')
            if (index > 0) values[Uri.decode(pair.substring(0, index))] = Uri.decode(pair.substring(index + 1))
        }
        val accessToken = values["access_token"]
        val refreshToken = values["refresh_token"]
        if (!accessToken.isNullOrBlank() && !refreshToken.isNullOrBlank()) {
            val email = values["email"] ?: currentSession()?.email
            saveSession(accessToken, refreshToken, email)
            return AuthResult.SignedIn(email)
        }
        return if (values["type"] == "recovery") AuthResult.RecoveryReady
        else AuthResult.Failed("Abra o link novamente ou entre com seu e-mail e senha.")
    }

    private suspend fun request(
        path: String,
        body: kotlinx.serialization.json.JsonObject,
        accessToken: String? = null,
        method: String = "POST",
        onSuccess: (kotlinx.serialization.json.JsonObject) -> AuthResult = { AuthResult.SignedOut },
    ): AuthResult {
        val response = runCatching {
            HttpClient(Android).use { client ->
                val result = if (method == "PUT") client.put("$baseUrl/$path") {
                    commonHeaders(accessToken)
                    setBody(body.toString())
                } else client.post("$baseUrl/$path") {
                    commonHeaders(accessToken)
                    setBody(body.toString())
                }
                result.status.value to result.bodyAsText()
            }
        }.getOrElse { return AuthResult.Failed("Não foi possível acessar sua conta. Verifique a internet e tente novamente.") }

        if (response.first !in 200..299) return AuthResult.Failed(readError(response.second))
        return runCatching { onSuccess(json.parseToJsonElement(response.second).jsonObject) }
            .getOrElse { AuthResult.Failed("A resposta do servidor não pôde ser processada.") }
    }

    private fun io.ktor.client.request.HttpRequestBuilder.commonHeaders(accessToken: String?) {
        header("apikey", publishableKey)
        header(HttpHeaders.Authorization, "Bearer ${accessToken ?: publishableKey}")
        contentType(ContentType.Application.Json)
        accept(ContentType.Application.Json)
    }

    private fun saveSession(root: kotlinx.serialization.json.JsonObject, fallbackEmail: String) {
        saveSession(
            root["access_token"]?.jsonPrimitive?.content.orEmpty(),
            root["refresh_token"]?.jsonPrimitive?.content.orEmpty(),
            root["user"]?.jsonObject?.get("email")?.jsonPrimitive?.contentOrNull ?: fallbackEmail,
        )
    }

    private fun saveSession(accessToken: String, refreshToken: String, email: String?) {
        if (accessToken.isBlank() || refreshToken.isBlank()) return
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, accessToken)
            .putString(KEY_REFRESH_TOKEN, refreshToken)
            .putString(KEY_EMAIL, email)
            .apply()
    }

    private fun readError(body: String): String = runCatching {
        val root = json.parseToJsonElement(body).jsonObject
        root["msg"]?.jsonPrimitive?.contentOrNull
            ?: root["message"]?.jsonPrimitive?.contentOrNull
            ?: root["error_description"]?.jsonPrimitive?.contentOrNull
            ?: "Não foi possível concluir a solicitação."
    }.getOrDefault("Não foi possível concluir a solicitação.")

    private fun isConfigured() = publishableKey.startsWith("sb_publishable_")
    private fun notConfigured() = AuthResult.Failed("A chave pública do Supabase ainda não foi configurada neste aplicativo.")
    private fun isValidCredentials(email: String, password: String) =
        android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches() && password.length >= 8

    private companion object {
        const val AUTH_CALLBACK = "gpslandmensure://auth-callback"
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_REFRESH_TOKEN = "refresh_token"
        const val KEY_EMAIL = "email"
    }
}
