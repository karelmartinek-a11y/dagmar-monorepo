package cz.hcasc.dagmar.core.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertFalse

class TimeInputNormalizerTest {
    @Test
    fun `normalize empty`() {
        assertEquals("", TimeInputNormalizer.normalize(""))
    }

    @Test
    fun `normalize four digit`() {
        assertEquals("10:00", TimeInputNormalizer.normalize("1000"))
    }

    @Test
    fun `normalize with colon`() {
        assertEquals("09:05", TimeInputNormalizer.normalize("9:05"))
        assertEquals("23:59", TimeInputNormalizer.normalize("23:59"))
    }

    @Test
    fun `normalize hour only`() {
        assertEquals("01:00", TimeInputNormalizer.normalize("1"))
    }

    @Test
    fun `valid or empty checks`() {
        assertTrue(TimeInputNormalizer.isValidOrEmpty(""))
        assertTrue(TimeInputNormalizer.isValidOrEmpty("1000"))
        assertFalse(TimeInputNormalizer.isValidOrEmpty("2560"))
    }
}
