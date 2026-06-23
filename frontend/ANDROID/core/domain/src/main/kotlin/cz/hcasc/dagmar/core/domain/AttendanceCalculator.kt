package cz.hcasc.dagmar.core.domain

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

enum class EmploymentTemplate { DPP_DPC, HPP }

data class AttendanceRow(
    val date: String,
    val arrivalTime: String?,
    val departureTime: String?
)

data class DayCalcResult(
    val workedMinutes: Int?,
    val breakMinutes: Int,
    val breakLabel: String?,
    val breakTooltip: String?,
    val afternoonMinutes: Int,
    val weekendHolidayMinutes: Int,
    val isWeekend: Boolean,
    val holidayName: String?,
    val isWeekendOrHoliday: Boolean
)

data class MonthStats(
    val totalMinutes: Int,
    val breakMinutes: Int,
    val afternoonMinutes: Int,
    val weekendHolidayMinutes: Int
)

object AttendanceCalculator {
    private val timeRegex = Regex("^(\\d{1,2}):(\\d{2})$")
    private val dateRegex = DateTimeFormatter.ofPattern("yyyy-MM-dd")

    fun parseCutoffMinutes(value: String?, fallback: String = "17:00"): Int {
        return parseTimeToMinutes(value) ?: parseTimeToMinutes(fallback) ?: 17 * 60
    }

    private fun parseTimeToMinutes(value: String?): Int? {
        if (value.isNullOrBlank()) return null
        val match = timeRegex.matchEntire(value.trim()) ?: return null
        val hh = match.groupValues[1].toIntOrNull() ?: return null
        val mm = match.groupValues[2].toIntOrNull() ?: return null
        if (hh !in 0..23 || mm !in 0..59) return null
        return hh * 60 + mm
    }

    fun isWeekend(date: String): Boolean {
        val parsed = LocalDate.parse(date, dateRegex)
        val dow = parsed.dayOfWeek
        return dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY
    }

    fun getHolidayName(date: String): String? {
        val parsed = LocalDate.parse(date, dateRegex)
        return HolidayCalendar.nameFor(parsed)
    }

    fun workingDaysInMonth(year: Int, month: Int): Int {
        val start = LocalDate.of(year, month, 1)
        val end = start.plusMonths(1)
        var count = 0
        var current = start
        while (current.isBefore(end)) {
            if (current.dayOfWeek != DayOfWeek.SATURDAY && current.dayOfWeek != DayOfWeek.SUNDAY) {
                if (HolidayCalendar.nameFor(current) == null) {
                    count++
                }
            }
            current = current.plusDays(1)
        }
        return count
    }

    fun computeDayCalc(row: AttendanceRow, template: EmploymentTemplate, cutoffMinutes: Int): DayCalcResult {
        val arrival = parseTimeToMinutes(row.arrivalTime)
        val departure = parseTimeToMinutes(row.departureTime)
        if (arrival == null || departure == null || departure <= arrival) {
            val isWeekend = runCatching { isWeekend(row.date) }.getOrDefault(false)
            return DayCalcResult(null, 0, null, null, 0, 0, isWeekend, getHolidayName(row.date), isWeekend)
        }

        val isWeekend = isWeekend(row.date)
        val holidayName = getHolidayName(row.date)
        val isWeekendOrHoliday = isWeekend || holidayName != null

        if (template != EmploymentTemplate.HPP) {
            return DayCalcResult(departure - arrival, 0, null, null, 0, 0, isWeekend, holidayName, isWeekendOrHoliday)
        }

        val breaks = computeBreakWindows(arrival, departure)
        val segments = subtractBreaks(arrival, departure, breaks)
        val worked = segments.sumOf { it.second - it.first }
        val afternoon = segments.sumOf { overlap(it.first, it.second, cutoffMinutes, 24 * 60) }
        val weekendHolidayMinutes = if (isWeekendOrHoliday) worked else 0
        val breakMinutes = breaks.size * 30
        val breakLabel = if (breakMinutes > 0) breakLabelFromMinutes(breakMinutes) else null
        val breakTooltip = if (breaks.isNotEmpty()) breakTooltipFromWindows(breaks) else null
        return DayCalcResult(worked, breakMinutes, breakLabel, breakTooltip, afternoon, weekendHolidayMinutes, isWeekend, holidayName, isWeekendOrHoliday)
    }

    fun computeMonthStats(rows: List<AttendanceRow>, template: EmploymentTemplate, cutoffMinutes: Int): MonthStats {
        var total = 0
        var breaks = 0
        var afternoon = 0
        var weekend = 0
        for (row in rows) {
            val calc = computeDayCalc(row, template, cutoffMinutes)
            if (calc.workedMinutes != null) total += calc.workedMinutes
            breaks += calc.breakMinutes
            afternoon += calc.afternoonMinutes
            weekend += calc.weekendHolidayMinutes
        }
        return if (template == EmploymentTemplate.HPP) {
            MonthStats(total, breaks, afternoon, weekend)
        } else {
            MonthStats(total, 0, 0, 0)
        }
    }

    private fun computeBreakWindows(start: Int, end: Int): List<Pair<Int, Int>> {
        val windows = mutableListOf<Pair<Int, Int>>()
        val duration = end - start
        if (duration >= 6 * 60 + 30) windows += start + 6 * 60 to start + 6 * 60 + 30
        if (duration >= 12 * 60 + 30) windows += start + 12 * 60 to start + 12 * 60 + 30
        return windows
    }

    private fun subtractBreaks(start: Int, end: Int, breaks: List<Pair<Int, Int>>): List<Pair<Int, Int>> {
        if (breaks.isEmpty()) return listOf(start to end)
        val segments = mutableListOf<Pair<Int, Int>>()
        var cursor = start
        for (breakWindow in breaks) {
            if (breakWindow.first > cursor) segments += cursor to breakWindow.first
            cursor = maxOf(cursor, breakWindow.second)
        }
        if (cursor < end) segments += cursor to end
        return segments.filter { (s, e) -> e > s }
    }

    private fun overlap(aStart: Int, aEnd: Int, bStart: Int, bEnd: Int): Int {
        val start = maxOf(aStart, bStart)
        val end = minOf(aEnd, bEnd)
        return maxOf(0, end - start)
    }

    private fun breakLabelFromMinutes(minutes: Int): String {
        val h = minutes / 60
        val m = minutes % 60
        return "−%d:%02d pauza".format(h, m)
    }

    private fun breakTooltipFromWindows(windows: List<Pair<Int, Int>>): String {
        if (windows.isEmpty()) return ""
        val parts = windows.map { "%02d:%02d−%02d:%02d".format(it.first / 60, it.first % 60, it.second / 60, it.second % 60) }
        val total = windows.size * 30
        val prefix = if (windows.size == 1) "Pauza" else "Pauzy"
        val label = breakLabelFromMinutes(total).removePrefix("−")
        return "$prefix $label (${parts.joinToString(", ")})"
    }
}

object HolidayCalendar {
    private val cached = mutableMapOf<Int, Map<LocalDate, String>>()

    fun nameFor(date: LocalDate): String? {
        val map = cached.getOrPut(date.year) { buildCalendar(date.year) }
        return map[date]
    }

    fun nameFor(dateIso: String): String? {
        val parsed = LocalDate.parse(dateIso, DateTimeFormatter.ISO_DATE)
        return nameFor(parsed)
    }

    private fun buildCalendar(year: Int): Map<LocalDate, String> {
        val map = mutableMapOf<LocalDate, String>()
        val fixed = listOf(
            "01-01" to "Nový rok / Den obnovy samostatného českého státu",
            "05-01" to "Svátek práce",
            "05-08" to "Den vítězství",
            "07-05" to "Cyril a Metoděj",
            "07-06" to "Upálení mistra Jana Husa",
            "09-28" to "Den české státnosti",
            "10-28" to "Vznik samostatného Československa",
            "11-17" to "Den boje za svobodu a demokracii",
            "12-24" to "Štědrý den",
            "12-25" to "1. svátek vánoční",
            "12-26" to "2. svátek vánoční",
        )
        fixed.forEach { (mmdd, name) -> map[LocalDate.parse("$year-$mmdd", DateTimeFormatter.ISO_DATE)] = name }
        val easter = easterSunday(year)
        map[easter.minusDays(2)] = "Velký pátek"
        map[easter.plusDays(1)] = "Velikonoční pondělí"
        return map
    }

    private fun easterSunday(year: Int): LocalDate {
        val a = year % 19
        val b = year / 100
        val c = year % 100
        val d = b / 4
        val e = b % 4
        val f = (b + 8) / 25
        val g = (b - f + 1) / 3
        val h = (19 * a + b - d - g + 15) % 30
        val i = c / 4
        val k = c % 4
        val l = (32 + 2 * e + 2 * i - h - k) % 7
        val m = (a + 11 * h + 22 * l) / 451
        val month = (h + l - 7 * m + 114) / 31
        val day = ((h + l - 7 * m + 114) % 31) + 1
        return LocalDate.of(year, month, day)
    }
}
