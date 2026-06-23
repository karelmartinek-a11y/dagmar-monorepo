package cz.hcasc.dagmar.core.auth

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject

private const val DATA_STORE_NAME = "portal_auth"
private val Context.portalAuthDataStore by preferencesDataStore(DATA_STORE_NAME)

data class PortalAuthState(
    val accessToken: String? = null,
    val employmentId: Int? = null,
    val displayName: String? = null,
)

class PortalAuthStore @Inject constructor(@ApplicationContext context: Context) {
    private val dataStore = context.portalAuthDataStore
    private val tokenKey = stringPreferencesKey("access_token")
    private val employmentKey = intPreferencesKey("employment_id")
    private val displayKey = stringPreferencesKey("display_name")

    val state: Flow<PortalAuthState> = dataStore.data.map { prefs ->
        PortalAuthState(
            accessToken = prefs[tokenKey],
            employmentId = prefs[employmentKey],
            displayName = prefs[displayKey],
        )
    }

    suspend fun save(state: PortalAuthState) {
        dataStore.edit { prefs ->
            state.accessToken?.let { prefs[tokenKey] = it } ?: prefs.remove(tokenKey)
            state.employmentId?.let { prefs[employmentKey] = it } ?: prefs.remove(employmentKey)
            state.displayName?.let { prefs[displayKey] = it } ?: prefs.remove(displayKey)
        }
    }

    suspend fun clear() {
        dataStore.edit { prefs ->
            prefs.remove(tokenKey)
            prefs.remove(employmentKey)
            prefs.remove(displayKey)
        }
    }
}
