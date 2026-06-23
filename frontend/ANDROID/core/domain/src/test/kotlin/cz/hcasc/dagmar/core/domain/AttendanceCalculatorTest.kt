package cz.hcasc.dagmar.core.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class AttendanceCalculatorTest {
    @Test
    fun `detect weekend and holiday`() {
        assertEquals(true, AttendanceCalculator.isWeekend("2026-05-03"))
        assertEquals("Svátek práce", AttendanceCalculator.getHolidayName("2026-05-01"))
    }

    @Test
    fun `working days counts working days correctly`() {
        val feb = AttendanceCalculator.workingDaysInMonth(2026, 2)
        assertEquals(20, feb)
    }

    @Test
    fun `day calc for hpp uses breaks`() {
        val row = AttendanceRow("2026-04-20", "08:00", "17:15")
        val cutoff = AttendanceCalculator.parseCutoffMinutes("17:00")
        val calc = AttendanceCalculator.computeDayCalc(row, EmploymentTemplate.HPP, cutoff)
        assertNotNull(calc.workedMinutes)
        assertEquals(true, calc.breakMinutes > 0)
        assertEquals(255, calc.workedMinutes)
    }
}
