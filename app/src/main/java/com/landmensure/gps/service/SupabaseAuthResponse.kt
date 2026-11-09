package com.landmensure.gps.service

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

data class AccountSession(val accessToken: String, val refreshToken: String, val email: String?)

sealed interface AuthResult {
    data class SignedIn(val email: String?) : AuthResult
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

internal fun readAuthSession(root: JsonObject, fallbackEmail: String): AccountSession? {
    val accessToken = root.stringValue("access_token") ?: return null
    val refreshToken = root.stringValue("refresh_token") ?: return null
    val email = (root["user"] as? JsonObject)?.stringValue("email") ?: fallbackEmail.trim()
    return AccountSession(accessToken, refreshToken, email)
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
        return AuthResult.SignedIn(session.email)
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
