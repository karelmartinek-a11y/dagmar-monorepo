package cz.hcasc.dagmar.core.data

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import cz.hcasc.dagmar.core.network.AttendanceApi
import cz.hcasc.dagmar.core.network.AttendanceUpdateRequest
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import javax.inject.Inject
import javax.inject.Singleton

private const val DATA_STORE_NAME = "attendance_queue"
private val Context.attendanceQueueDataStore by preferencesDataStore(DATA_STORE_NAME)

@Serializable
data class AttendanceChange(
    val employment_id: Int,
    val date: String,
    val arrival_time: String? = null,
    val departure_time: String? = null,
    val enqueuedAt: Long,
)

@Singleton
class AttendanceQueueRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val attendanceApi: AttendanceApi,
) {
    private val dataStore = context.attendanceQueueDataStore
    private val queueKey = stringPreferencesKey("queue")
    private val json = Json { ignoreUnknownKeys = true }
    private val mutex = Mutex()

    val queue: Flow<List<AttendanceChange>> = dataStore.data.map { prefs ->
        prefs[queueKey]?.let { json.decodeFromString(it) } ?: emptyList()
    }

    suspend fun enqueue(change: AttendanceChange) {
        mutex.withLock {
            dataStore.edit { prefs ->
                val current = prefs[queueKey]?.let { json.decodeFromString<List<AttendanceChange>>(it) } ?: emptyList()
                val filtered = current.filterNot { it.date == change.date }
                val updated = filtered + change
                prefs[queueKey] = json.encodeToString(updated)
            }
        }
    }

    suspend fun flush() {
        mutex.withLock {
            val prefs = dataStore.data.first()
            val pending = prefs[queueKey]?.let { json.decodeFromString<List<AttendanceChange>>(it) } ?: emptyList()
            for (change in pending.sortedBy { it.enqueuedAt }) {
                attendanceApi.upsert(
                    AttendanceUpdateRequest(
                        employment_id = change.employment_id,
                        date = change.date,
                        arrival_time = change.arrival_time,
                        departure_time = change.departure_time,
                    ),
                )
            }
            dataStore.edit { it.remove(queueKey) }
        }
    }
}
