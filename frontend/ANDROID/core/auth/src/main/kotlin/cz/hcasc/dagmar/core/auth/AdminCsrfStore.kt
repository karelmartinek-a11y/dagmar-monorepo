package cz.hcasc.dagmar.core.auth

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject

private const val ADMIN_DATA_STORE = "admin_session"
private val Context.adminCsrfDataStore by preferencesDataStore(ADMIN_DATA_STORE)

class AdminCsrfStore @Inject constructor(@ApplicationContext context: Context) {
    private val dataStore = context.adminCsrfDataStore
    private val csrfKey = stringPreferencesKey("csrf_token")

    val token: Flow<String?> = dataStore.data.map { it[csrfKey] }

    suspend fun save(token: String) {
        dataStore.edit { prefs ->
            prefs[csrfKey] = token
        }
    }

    suspend fun clear() {
        dataStore.edit { prefs ->
            prefs.remove(csrfKey)
        }
    }
}
