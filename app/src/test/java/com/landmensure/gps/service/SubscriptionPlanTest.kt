package com.landmensure.gps.service

import org.junit.Assert.assertEquals
import org.junit.Test

class SubscriptionPlanTest {
    @Test
    fun `cada plano envia o identificador esperado pelo backend`() {
        assertEquals("weekly", SubscriptionPlan.WEEKLY.backendId)
        assertEquals("monthly", SubscriptionPlan.MONTHLY.backendId)
        assertEquals("yearly", SubscriptionPlan.YEARLY.backendId)
    }

    @Test
    fun `identificadores de plano sao distintos`() {
        assertEquals(SubscriptionPlan.entries.size, SubscriptionPlan.entries.map { it.backendId }.distinct().size)
    }

    @Test
    fun `credenciais exigem e-mail valido e senha forte`() {
        assertEquals(true, AccountCredentials.isValidEmail("campo@landmensure.com"))
        assertEquals(false, AccountCredentials.isValidEmail("sem-arroba"))
        assertEquals(true, AccountCredentials.isStrongPassword("Land2026Seguro"))
        assertEquals(false, AccountCredentials.isStrongPassword("land2026"))
        assertEquals(false, AccountCredentials.isStrongPassword("LAND2026SEGURA"))
        assertEquals(false, AccountCredentials.isStrongPassword("LandmensureSegura"))
    }
}
