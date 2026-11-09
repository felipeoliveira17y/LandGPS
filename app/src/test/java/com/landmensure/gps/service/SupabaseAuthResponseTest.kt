package com.landmensure.gps.service

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SupabaseAuthResponseTest {
    @Test
    fun `cadastro com tokens na raiz salva sessao e entra automaticamente`() {
        val response = Json.parseToJsonElement(
            """{"access_token":"access","refresh_token":"refresh","user":{"email":"campo@landmensure.com"}}""",
        ).jsonObject
        var session: AccountSession? = null

        val result = finishRegistration(response, "fallback@landmensure.com") { session = it }

        assertEquals(AccountSession("access", "refresh", "campo@landmensure.com"), session)
        assertEquals(AuthResult.SignedIn("campo@landmensure.com"), result)
    }

    @Test
    fun `cadastro que devolve apenas usuario ainda pede confirmacao`() {
        val response = Json.parseToJsonElement(
            """{"id":"test-user","email":"campo@landmensure.com","email_confirmed_at":null}""",
        ).jsonObject

        val result = finishRegistration(response, "campo@landmensure.com") {
            error("Não há sessão para salvar antes da confirmação.")
        }

        assertEquals(AuthResult.ConfirmationSent, result)
    }

    @Test
    fun `resposta incompleta nao cria sessao nem pede confirmacao`() {
        val response = Json.parseToJsonElement("""{"access_token":"access","refresh_token":null}""").jsonObject

        val result = finishRegistration(response, "campo@landmensure.com") {
            error("Não é possível salvar uma sessão sem refresh token.")
        }

        assertTrue(result is AuthResult.Failed)
        assertNull(readAuthSession(response, "campo@landmensure.com"))
    }

    @Test
    fun `erros conhecidos orientam a acao e so marcam o campo correspondente`() {
        assertTrue(authApiFailure(400, "email_not_confirmed").message.contains("confirmado"))
        assertNull(authApiFailure(400, "invalid_credentials").field)
        assertEquals("email", authApiFailure(422, "email_address_invalid").field)
        assertEquals("password", authApiFailure(422, "weak_password").field)
    }
}
