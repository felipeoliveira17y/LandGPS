package com.landmensure.gps.service

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.landmensure.gps.BuildConfig
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.request.accept
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

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
    private val restUrl = "https://tfuiwogiwbvqxfqktnwe.supabase.co/rest/v1"
    private val publishableKey = BuildConfig.SUPABASE_PUBLISHABLE_KEY
    private val sessionLock = Any()
    private val refreshLock = Mutex()

    fun currentSession(): AccountSession? = synchronized(sessionLock) {
        val accessToken = prefs.getString(KEY_ACCESS_TOKEN, null) ?: return@synchronized null
        val refreshToken = prefs.getString(KEY_REFRESH_TOKEN, null) ?: return@synchronized null
        val userId = normalizeSupabaseUserId(prefs.getString(KEY_USER_ID, null))
            ?: readSupabaseUserId(accessToken) ?: return@synchronized null
        AccountSession(accessToken, refreshToken, prefs.getString(KEY_EMAIL, null), userId)
    }

    /** Valida a sessão persistida e tenta renová-la uma vez antes de tratá-la como expirada. */
    suspend fun ensureActiveSession(): Boolean = refreshLock.withLock {
        val session = currentSession() ?: return@withLock false
        if (!isConfigured()) return@withLock false
        val validationStatus = runCatching {
            HttpClient(Android).use { client ->
                client.get("$baseUrl/user") {
                    header("apikey", publishableKey)
                    header(HttpHeaders.Authorization, "Bearer ${session.accessToken}")
                    accept(ContentType.Application.Json)
                }.status.value
            }
        }.getOrNull()
        if (validationStatus == null) return@withLock currentSession() != null
        if (validationStatus in 200..299) return@withLock currentSession() != null
        // Somente credenciais recusadas devem disparar refresh/limpeza. Respostas como 429
        // ou 5xx pertencem ao servidor e não podem derrubar uma sessão válida localmente.
        if (validationStatus !in setOf(401, 403)) return@withLock currentSession() != null
        if (currentSession() != session) return@withLock currentSession() != null

        val refreshed = runCatching {
            HttpClient(Android).use { client ->
                val response = client.post("$baseUrl/token?grant_type=refresh_token") {
                    header("apikey", publishableKey)
                    contentType(ContentType.Application.Json)
                    setBody(buildJsonObject { put("refresh_token", session.refreshToken) }.toString())
                }
                if (response.status.value in setOf(400, 401, 403)) false
                else if (response.status.value !in 200..299) null
                else {
                    val root = json.parseToJsonElement(response.bodyAsText()).jsonObject
                    val renewed = readAuthSession(root, session.email.orEmpty()) ?: return@use false
                    if (renewed.userId != session.userId) return@use false
                    synchronized(sessionLock) {
                        if (currentSession() == session) saveSession(renewed)
                    }
                    true
                }
            }
        }.getOrNull()
        if (refreshed == null) return@withLock currentSession() != null
        synchronized(sessionLock) {
            if (!refreshed && currentSession() == session) prefs.edit().clear().apply()
        }
        currentSession() != null
    }

    /** Falha fechada: em caso de rede ou sessão inválida, recursos Pro não são liberados. */
    suspend fun hasActivePro(): Boolean {
        val session = currentSession() ?: return false
        if (!isConfigured()) return false
        return runCatching {
            HttpClient(Android).use { client ->
                val response = client.post("$restUrl/rpc/has_active_pro") {
                    header("apikey", publishableKey)
                    header(HttpHeaders.Authorization, "Bearer ${session.accessToken}")
                    contentType(ContentType.Application.Json)
                    setBody("{}")
                }
                response.status.value in 200..299 && response.bodyAsText().trim() == "true"
            }
        }.getOrDefault(false) && currentSession()?.userId == session.userId
    }

    suspend fun signUp(email: String, password: String): AuthResult {
        if (!isConfigured()) return notConfigured()
        if (!AccountCredentials.isValidEmail(email)) return invalidEmail()
        if (!AccountCredentials.isStrongPassword(password)) return AuthResult.Failed(AccountCredentials.passwordHint, "password")
        return request("signup", buildJsonObject {
            put("email", email.trim())
            put("password", password)
        }) { root ->
            finishRegistration(root, email, ::saveSession)
        }
    }

    suspend fun signIn(email: String, password: String): AuthResult {
        if (!isConfigured()) return notConfigured()
        if (!AccountCredentials.isValidEmail(email)) return invalidEmail()
        if (password.isBlank()) return AuthResult.Failed("Digite sua senha para entrar.", "password")
        return request("token?grant_type=password", buildJsonObject {
            put("email", email.trim())
            put("password", password)
        }) { root ->
            val session = readAuthSession(root, email) ?: return@request AuthResult.Failed(INVALID_AUTH_RESPONSE)
            saveSession(session)
            AuthResult.SignedIn(session.email, session.userId)
        }
    }

    suspend fun sendPasswordRecovery(email: String): AuthResult {
        return AuthResult.Failed("Recuperação de senha será liberada quando o domínio seguro do aplicativo estiver configurado.")
    }

    suspend fun updatePassword(password: String): AuthResult {
        val session = currentSession() ?: return AuthResult.Failed("Faça login novamente para alterar a senha.")
        if (!AccountCredentials.isStrongPassword(password)) return AuthResult.Failed(AccountCredentials.passwordHint, "password")
        return request("user", buildJsonObject { put("password", password) }, session.accessToken, method = "PUT") {
            AuthResult.PasswordUpdated
        }
    }

    suspend fun signOut(): AuthResult {
        val session = synchronized(sessionLock) {
            currentSession().also { prefs.edit().clear().apply() }
        }
        if (session != null && isConfigured()) {
            request("logout?scope=local", buildJsonObject {}, session.accessToken)
        }
        return AuthResult.SignedOut
    }

    private suspend fun request(
        path: String,
        body: JsonObject,
        accessToken: String? = null,
        method: String = "POST",
        onSuccess: (JsonObject) -> AuthResult = { AuthResult.SignedOut },
    ): AuthResult {
        val (status, responseBody, errorCode) = runCatching {
            HttpClient(Android).use { client ->
                val result = if (method == "PUT") client.put("$baseUrl/$path") {
                    commonHeaders(accessToken)
                    setBody(body.toString())
                } else client.post("$baseUrl/$path") {
                    commonHeaders(accessToken)
                    setBody(body.toString())
                }
                Triple(result.status.value, result.bodyAsText(), result.headers["x-sb-error-code"])
            }
        }.getOrElse { return AuthResult.Failed("Não foi possível acessar sua conta. Verifique a internet e tente novamente.") }

        if (status !in 200..299) {
            val error = runCatching { json.parseToJsonElement(responseBody) as? JsonObject }.getOrNull()
            val code = error?.stringValue("error_code") ?: errorCode ?: error?.stringValue("code")
            return authApiFailure(status, code)
        }
        return runCatching { onSuccess(json.parseToJsonElement(responseBody).jsonObject) }
            .getOrElse { AuthResult.Failed(INVALID_AUTH_RESPONSE) }
    }

    private fun io.ktor.client.request.HttpRequestBuilder.commonHeaders(accessToken: String?) {
        header("apikey", publishableKey)
        header(HttpHeaders.Authorization, "Bearer ${accessToken ?: publishableKey}")
        contentType(ContentType.Application.Json)
        accept(ContentType.Application.Json)
    }

    private fun saveSession(session: AccountSession) = synchronized(sessionLock) {
        prefs.edit()
            .putString(KEY_ACCESS_TOKEN, session.accessToken)
            .putString(KEY_REFRESH_TOKEN, session.refreshToken)
            .putString(KEY_EMAIL, session.email)
            .putString(KEY_USER_ID, session.userId)
            .apply()
    }

    private fun isConfigured() = publishableKey.startsWith("sb_publishable_")
    private fun notConfigured() = AuthResult.Failed("O acesso à conta não está disponível nesta versão. Fale com o suporte.")
    private fun invalidEmail() = AuthResult.Failed("Confira seu endereço de e-mail e tente de novo.", "email")

    private companion object {
        const val KEY_ACCESS_TOKEN = "access_token"
        const val KEY_REFRESH_TOKEN = "refresh_token"
        const val KEY_EMAIL = "email"
        const val KEY_USER_ID = "user_id"
    }
}
