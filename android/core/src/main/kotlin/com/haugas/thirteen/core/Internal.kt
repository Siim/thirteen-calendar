package com.haugas.thirteen.core

/**
 * Unchecked integer calendar arithmetic shared by the public types (mirrors `internal.ts` and
 * Swift's `Calc`). Callers validate first; nothing here throws for valid input.
 */
internal object Calc {
    val monthNames: List<String> = listOf(
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    )
    val monthShortNames: List<String> =
        listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
    val monthNarrowNames: List<String> = listOf("J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D")

    /** Julian Day Number of 1970-01-01 (the Unix epoch day, `LocalDate.ofEpochDay(0)`). */
    const val UNIX_EPOCH_JULIAN_DAY_NUMBER: Int = 2_440_588

    private val daysBeforeMonth = intArrayOf(0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334)

    fun isLeap(year: Int): Boolean = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)

    fun daysInYear(year: Int): Int = if (isLeap(year)) 366 else 365

    /** Length of a valid month, 28 to 31. */
    fun daysInMonth(year: Int, month: Int): Int = when (month) {
        2 -> if (isLeap(year)) 29 else 28
        4, 6, 9, 11 -> 30
        else -> 31
    }

    /** Days before the first of a valid month in a common year. */
    fun daysBeforeMonth(month: Int): Int = daysBeforeMonth[month - 1]

    fun dayOfYear(year: Int, month: Int, day: Int): Int =
        daysBeforeMonth(month) + day + if (month > 2 && isLeap(year)) 1 else 0

    /** Month (1..12) of a valid day-of-year. */
    fun monthOfDayOfYear(year: Int, dayOfYear: Int): Int {
        val leap = isLeap(year)
        if (leap && dayOfYear == 60) return 2
        val common = if (leap && dayOfYear > 60) dayOfYear - 1 else dayOfYear
        var month = (common - 1) / 31 + 1 // lower bound: no month is longer than 31 days
        while (month < 12 && daysBeforeMonth(month + 1) < common) month++
        return month
    }

    /** The date on a valid day-of-year of a valid year. */
    fun dateOfDayOfYear(year: Int, dayOfYear: Int): GregorianDate {
        val month = monthOfDayOfYear(year, dayOfYear)
        val day = dayOfYear - daysBeforeMonth(month) - if (month > 2 && isLeap(year)) 1 else 0
        return GregorianDate(year, month, day)
    }

    /**
     * Chronological Julian Day Number (2000-01-01 is 2451545). Valid for years >= 1, where every
     * operand is non-negative, so truncating division equals the floor division of the TS original.
     */
    fun julianDayNumber(year: Int, month: Int, day: Int): Int {
        val a = (14 - month) / 12
        val y = year + 4800 - a
        val m = month + 12 * a - 3
        return day + (153 * m + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 32045
    }

    /** Inverse of [julianDayNumber] for the JDNs of years 1..9999. */
    fun dateOfJulianDayNumber(jdn: Int): GregorianDate {
        val a = jdn + 32044
        val b = (4 * a + 3) / 146_097
        val c = a - (146_097 * b) / 4
        val d = (4 * c + 3) / 1461
        val e = c - (1461 * d) / 4
        val m = (5 * e + 2) / 153
        return GregorianDate(100 * b + d - 4800 + m / 10, m + 3 - 12 * (m / 10), e - (153 * m + 2) / 5 + 1)
    }

    /** True (non-negative) modulo. */
    fun mod(value: Int, modulus: Int): Int = Math.floorMod(value, modulus)

    /** Zero-pads a non-negative magnitude to [width] digits. */
    fun pad(value: Long, width: Int): String = value.toString().padStart(width, '0')

    fun pad(value: Int, width: Int): String = pad(value.toLong(), width)

    /** Parses [count] ASCII digits of [text] starting at [start], or -1 if any is not `0..9`. */
    fun digits(text: CharSequence, start: Int, count: Int): Int {
        if (start < 0 || start + count > text.length) return -1
        var value = 0
        for (i in start until start + count) {
            val c = text[i]
            if (c !in '0'..'9') return -1
            value = value * 10 + (c - '0')
        }
        return value
    }

    /** Renders text inside an error message the way `JSON.stringify` would for simple strings. */
    fun quoted(text: String): String = buildString {
        append('"')
        for (c in text) {
            when {
                c == '"' -> append("\\\"")
                c == '\\' -> append("\\\\")
                c == '\n' -> append("\\n")
                c == '\r' -> append("\\r")
                c == '\t' -> append("\\t")
                c.code < 0x20 -> append("\\u").append(c.code.toString(16).padStart(4, '0'))
                else -> append(c)
            }
        }
        append('"')
    }
}
