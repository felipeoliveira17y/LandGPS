package com.landmensure.gps.service

/** Regras puras de credencial, compartilhadas pelo login e pelos testes unitários. */
object AccountCredentials {
    private val emailPattern = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")

    fun isValidEmail(email: String): Boolean = email.trim().matches(emailPattern)

    fun isStrongPassword(password: String): Boolean =
        password.length >= 10 &&
            password.any(Char::isUpperCase) &&
            password.any(Char::isLowerCase) &&
            password.any(Char::isDigit)

    const val passwordHint = "Use ao menos 10 caracteres, com maiúscula, minúscula e número."
}
