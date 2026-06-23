package cz.hcasc.dagmar.core.data

import cz.hcasc.dagmar.core.auth.PortalAuthState
import cz.hcasc.dagmar.core.auth.PortalAuthStore
import cz.hcasc.dagmar.core.network.AttendanceApi
import cz.hcasc.dagmar.core.network.AttendanceDay
import cz.hcasc.dagmar.core.network.AttendanceUpdateRequest
import cz.hcasc.dagmar.core.network.PortalApi
import cz.hcasc.dagmar.core.network.PortalLoginRequest
import cz.hcasc.dagmar.core.network.PortalResetRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PortalRepository @Inject constructor(
    private val portalApi: PortalApi,
    private val attendanceApi: AttendanceApi,
    private val authStore: PortalAuthStore,
    private val queue: AttendanceQueueRepository,
) {
    val queuedCount: Flow<Int> = queue.queue.map { it.size }

    suspend fun login(email: String, password: String): PortalAuthState {
        val response = portalApi.login(PortalLoginRequest(email, password))
        val state = PortalAuthState(
            accessToken = response.instance_token,
            employmentId = response.employment_id,
            displayName = response.display_name,
        )
        authStore.save(state)
        return state
    }

    suspend fun logout() {
        authStore.clear()
    }

    suspend fun fetchAttendance(year: Int, month: String): List<AttendanceDay> {
        val employmentId = authStore.state.first().employmentId ?: return emptyList()
        return attendanceApi.month(employmentId, year, month).days
    }

    suspend fun recordChange(day: AttendanceDay) {
        val auth = authStore.state.first()
        auth.accessToken ?: return
        val employmentId = auth.employmentId ?: return
        val change = AttendanceChange(employmentId, day.date, day.arrival_time, day.departure_time, System.currentTimeMillis())
        try {
            attendanceApi.upsert(AttendanceUpdateRequest(employmentId, day.date, day.arrival_time, day.departure_time))
            queue.flush()
        } catch (t: Throwable) {
            queue.enqueue(change)
        }
    }

    suspend fun flushOffline() {
        val auth = authStore.state.first()
        auth.accessToken ?: return
        queue.flush()
    }

    suspend fun resetPassword(token: String, password: String) {
        portalApi.resetPassword(PortalResetRequest(token, password))
    }
}

