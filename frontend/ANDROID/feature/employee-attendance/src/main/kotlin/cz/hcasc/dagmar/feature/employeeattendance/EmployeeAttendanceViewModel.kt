package cz.hcasc.dagmar.feature.employeeattendance

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cz.hcasc.dagmar.core.data.PortalRepository
import cz.hcasc.dagmar.core.network.AttendanceDay
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.YearMonth
import javax.inject.Inject

data class AttendanceUiState(
    val rows: List<AttendanceDay> = emptyList(),
    val month: YearMonth = YearMonth.now(),
    val isLoading: Boolean = false,
    val error: String? = null,
    val queued: Int = 0,
)

@HiltViewModel
class EmployeeAttendanceViewModel @Inject constructor(private val repository: PortalRepository) : ViewModel() {
    private val _state = MutableStateFlow(AttendanceUiState())
    val uiState: StateFlow<AttendanceUiState> = _state

    init {
        refreshMonth(YearMonth.now())
        viewModelScope.launch {
            repository.queuedCount.collect { size ->
                _state.value = _state.value.copy(queued = size)
            }
        }
    }

    fun refreshMonth(month: YearMonth) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, month = month, error = null)
            try {
                val monthString = "%04d-%02d".format(month.year, month.monthValue)
                val days = repository.fetchAttendance(month.year, monthString)
                _state.value = _state.value.copy(rows = days, isLoading = false)
            } catch (t: Throwable) {
                _state.value = _state.value.copy(error = t.localizedMessage ?: "Nelze načíst", isLoading = false)
            }
        }
    }

    fun syncAttendance(day: AttendanceDay) {
        viewModelScope.launch {
            repository.recordChange(day)
        }
    }

    fun punchNow() {
        val today = LocalDate.now().toString()
        val row = _state.value.rows.find { it.date == today } ?: return
        val now = LocalDateTime.now()
        val formatted = "%02d:%02d".format(now.hour, now.minute)
        val newDay = when {
            row.arrival_time.isNullOrEmpty() -> row.copy(arrival_time = formatted)
            row.departure_time.isNullOrEmpty() -> row.copy(departure_time = formatted)
            else -> row
        }
        _state.value = _state.value.copy(rows = _state.value.rows.map { if (it.date == today) newDay else it })
        syncAttendance(newDay)
    }
}
