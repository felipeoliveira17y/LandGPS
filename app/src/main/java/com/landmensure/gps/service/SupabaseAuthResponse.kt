package com.landmensure.gps.service

import java.util.Base64
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

data class AccountSession(
    val accessToken: String,
    val refreshToken: String,
    val email: String?,
    val userId: String,
)

sealed interface AuthResult {
    data class SignedIn(val email: String?, val userId: String) : AuthResult
    data object ConfirmationSent : AuthResult
    data object SignedOut : AuthResult
    data class RecoverySent(val email: String) : AuthResult
    data object RecoveryReady : AuthResult
    data class PaymentReturned(val status: String) : AuthResult
    data object PasswordUpdated : AuthResult
    data class Failed(val message: String, val field: String? = null) : AuthResult
}

internal const val INVALID_AUTH_RESPONSE = "Não conseguimos concluir esta etapa. Tente novamente."

internal fun JsonObject.stringValue(key: String): String? =
    (get(key) as? JsonPrimitive)?.takeIf { it.isString }?.contentOrNull?.takeIf { it.isNotBlank() }

internal fun normalizeSupabaseUserId(value: String?): String? {
    if (value?.length != 36) return null
    return runCatching { UUID.fromString(value).toString() }
        .getOrNull()
        ?.takeIf { it.equals(value, ignoreCase = true) }
}

/** Fallback de identificação para tokens já recebidos do Auth, inclusive em sessões antigas.
 * O sub só separa dados locais. A autorização continua dependendo do token validado pelo servidor.
 */
internal fun readSupabaseUserId(accessToken: String): String? {
    val parts = accessToken.split('.', limit = 4)
    if (parts.size != 3 || parts.any { it.isEmpty() } || parts[1].length > 16384) return null
    return runCatching {
        val claims = Base64.getUrlDecoder().decode(parts[1]).toString(Charsets.UTF_8)
        val root = Json.parseToJsonElement(claims) as? JsonObject
        normalizeSupabaseUserId(root?.stringValue("sub"))
    }.getOrNull()
}

internal fun readAuthSession(root: JsonObject, fallbackEmail: String): AccountSession? {
    val accessToken = root.stringValue("access_token") ?: return null
    val refreshToken = root.stringValue("refresh_token") ?: return null
    val user = root["user"] as? JsonObject
    val tokenUserId = readSupabaseUserId(accessToken)
    val responseUserId = normalizeSupabaseUserId(user?.stringValue("id"))
    if (responseUserId != null && tokenUserId != null && responseUserId != tokenUserId) return null
    val userId = responseUserId ?: tokenUserId ?: return null
    val email = user?.stringValue("email") ?: fallbackEmail.trim()
    return AccountSession(accessToken, refreshToken, email, userId)
}

internal fun finishRegistration(
    root: JsonObject,
    email: String,
    saveSession: (AccountSession) -> Unit,
): AuthResult {
    // No endpoint REST, o cadastro com confirmação automática devolve os tokens na raiz.
    val session = readAuthSession(root, email)
        ?: (root["session"] as? JsonObject)?.let { readAuthSession(it, email) }
    if (session != null) {
        saveSession(session)
        return AuthResult.SignedIn(session.email, session.userId)
    }
    val user = (root["user"] as? JsonObject) ?: root
    return if (user.stringValue("id") != null) AuthResult.ConfirmationSent
    else AuthResult.Failed(INVALID_AUTH_RESPONSE)
}

internal fun authApiFailure(status: Int, code: String?): AuthResult.Failed = when (code) {
    "invalid_credentials", "user_not_found" ->
        AuthResult.Failed("E-mail ou senha incorretos. Confira os dados e tente de novo.")
    "email_not_confirmed" ->
        AuthResult.Failed("Seu e-mail ainda precisa ser confirmado. Procure a mensagem do Landmensure na caixa de entrada ou no spam.")
    "email_provider_disabled" ->
        AuthResult.Failed("O acesso por e-mail está indisponível. Se continuar assim, fale com o suporte.")
    "signup_disabled" -> AuthResult.Failed("O cadastro está fechado no momento. Tente mais tarde.")
    "email_exists", "user_already_exists" ->
        AuthResult.Failed("Já existe uma conta com esse e-mail. Toque em Entrar e use sua senha.")
    "email_address_invalid" -> AuthResult.Failed("Confira seu endereço de e-mail e tente de novo.", "email")
    "weak_password" -> AuthResult.Failed("Escolha uma senha mais forte e tente de novo.", "password")
    "email_address_not_authorized" ->
        AuthResult.Failed("Não conseguimos enviar o e-mail de confirmação. Fale com o suporte.")
    "over_request_rate_limit", "over_email_send_rate_limit" ->
        AuthResult.Failed("Houve muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.")
    "same_password" -> AuthResult.Failed("Escolha uma senha diferente da atual.", "password")
    else -> when (status) {
        429 -> AuthResult.Failed("Houve muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.")
        in 500..599 -> AuthResult.Failed("O serviço de conta está indisponível agora. Tente mais tarde.")
        else -> AuthResult.Failed(INVALID_AUTH_RESPONSE)
    }
}
