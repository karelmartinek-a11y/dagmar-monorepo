package cz.hcasc.dagmar.core.domain

object TimeInputNormalizer {
    private val fourDigit = Regex("^\\d{4}$")
    private val hhmm = Regex("^(\\d{1,2}):(\\d{2})$")
    private val hourOnly = Regex("^\\d{1,2}$")

    fun normalize(value: String): String {
        val v = value.trim()
        if (v.isEmpty()) return ""

        if (fourDigit.matches(v)) {
            val hh = v.substring(0, 2).toIntOrNull() ?: return v
            val mm = v.substring(2).toIntOrNull() ?: return v
            if (hh in 0..23 && mm in 0..59) return "%02d:%02d".format(hh, mm)
            return v
        }

        val colonMatch = hhmm.matchEntire(v)
        if (colonMatch != null) {
            val hh = colonMatch.groupValues[1].toIntOrNull() ?: return v
            val mm = colonMatch.groupValues[2].toIntOrNull() ?: return v
            if (hh in 0..23 && mm in 0..59) return "%02d:%02d".format(hh, mm)
            return v
        }

        if (hourOnly.matches(v)) {
            val hh = v.toIntOrNull() ?: return v
            if (hh in 1..23) return "%02d:00".format(hh)
        }

        return v
    }

    fun isValidOrEmpty(value: String): Boolean {
        val normalized = normalize(value)
        if (normalized.isEmpty()) return true
        return Regex("^([01]\\d|2[0-3]):([0-5]\\d)$").matches(normalized)
    }
}
