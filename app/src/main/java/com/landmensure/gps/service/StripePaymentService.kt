package com.landmensure.gps.service

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.landmensure.gps.BuildConfig
import io.ktor.client.HttpClient
import io.ktor.client.engine.android.Android
import io.ktor.client.request.accept
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** Identificadores aceitos pelo backend. Os Price IDs ficam somente no servidor. */
enum class SubscriptionPlan(val backendId: String) {
    WEEKLY("weekly"),
    MONTHLY("monthly"),
    YEARLY("yearly"),
}

sealed interface CheckoutResult {
    data object Opened : CheckoutResult
    data object NotAuthenticated : CheckoutResult
    data class Failed(val message: String) : CheckoutResult
}

private data class CheckoutHttpResponse(
    val successful: Boolean,
    val body: String,
)

/**
 * Inicia uma assinatura no Stripe por meio da Edge Function autenticada.
 * [accessToken] deve vir da sessão atual do Supabase Auth.
 */
class StripePaymentService(
    private val functionsUrl: String = BuildConfig.SUPABASE_FUNCTIONS_URL,
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun startCheckout(
        context: Context,
        accessToken: String?,
        plan: SubscriptionPlan,
    ): CheckoutResult {
        if (accessToken.isNullOrBlank()) return CheckoutResult.NotAuthenticated

        val response = runCatching {
            HttpClient(Android).use { client ->
                val result = client.post("$functionsUrl/create-checkout") {
                    header(HttpHeaders.Authorization, "Bearer $accessToken")
                    contentType(ContentType.Application.Json)
                    accept(ContentType.Application.Json)
                    setBody(buildJsonObject { put("plan", plan.backendId) }.toString())
                }
                CheckoutHttpResponse(
                    successful = result.status.value in 200..299,
                    body = result.bodyAsText(),
                )
            }
        }.getOrElse { error ->
            return CheckoutResult.Failed("Não foi possível iniciar o pagamento: ${error.message ?: "erro de rede"}")
        }

        if (!response.successful) {
            val message = runCatching {
                json.parseToJsonElement(response.body).jsonObject["error"]?.jsonPrimitive?.content
            }.getOrNull()
            return CheckoutResult.Failed(message ?: "Não foi possível iniciar o pagamento. Tente novamente.")
        }

        val checkoutUrl = runCatching {
            json.parseToJsonElement(response.body).jsonObject["url"]?.jsonPrimitive?.content
        }.getOrNull()

        if (checkoutUrl.isNullOrBlank()) {
            return CheckoutResult.Failed("O servidor não retornou uma página de pagamento válida.")
        }

        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(checkoutUrl)).apply {
            if (context !is android.app.Activity) addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return runCatching {
            context.startActivity(intent)
            CheckoutResult.Opened
        }.getOrElse {
            CheckoutResult.Failed("Não foi possível abrir o navegador para concluir o pagamento.")
        }
    }
}
