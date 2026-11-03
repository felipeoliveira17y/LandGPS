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
}
