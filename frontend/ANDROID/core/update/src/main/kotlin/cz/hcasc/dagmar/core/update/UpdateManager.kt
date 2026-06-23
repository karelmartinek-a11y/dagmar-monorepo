package cz.hcasc.dagmar.core.update

import android.content.Context
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.UpdateAvailability
import com.google.android.play.core.tasks.Task
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import javax.inject.Inject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

sealed class UpdateStatus {
    object UpToDate : UpdateStatus()
    data class Available(val mandatory: Boolean, val remoteVersion: Int) : UpdateStatus()
    data class Error(val message: String) : UpdateStatus()
}

interface UpdateManager {
    suspend fun checkForUpdate(currentVersion: Int): UpdateStatus
}

class PlayUpdateManager @Inject constructor(
    @ApplicationContext private val context: Context,
) : UpdateManager {
    private val manager = AppUpdateManagerFactory.create(context)

    override suspend fun checkForUpdate(currentVersion: Int): UpdateStatus = withContext(Dispatchers.IO) {
        return@withContext try {
            val info = manager.appUpdateInfo.await()
            if (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE || info.updateAvailability() == UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) {
                val mandatory = info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)
                val remote = info.availableVersionCode()
                UpdateStatus.Available(mandatory, remote)
            } else {
                UpdateStatus.UpToDate
            }
        } catch (t: Throwable) {
            UpdateStatus.Error(t.localizedMessage ?: "Update check failed")
        }
    }
}

class DirectUpdateManager @Inject constructor(private val client: OkHttpClient) : UpdateManager {
    companion object {
        private const val METADATA_URL = "https://dagmar.hcasc.cz/android-update.json"
    }

    override suspend fun checkForUpdate(currentVersion: Int): UpdateStatus = withContext(Dispatchers.IO) {
        return@withContext try {
            val request = Request.Builder().url(METADATA_URL).build()
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IOException("${response.code}: ${response.message}")
                val body = response.body?.string() ?: ""
                val metadata = Json.decodeFromString<UpdateMetadata>(body)
                if (metadata.versionCode > currentVersion) {
                    UpdateStatus.Available(metadata.mandatory, metadata.versionCode)
                } else {
                    UpdateStatus.UpToDate
                }
            }
        } catch (t: Throwable) {
            UpdateStatus.Error(t.localizedMessage ?: "Direct update check failed")
        }
    }
}

@Serializable
data class UpdateMetadata(val versionCode: Int, val mandatory: Boolean = false, val downloadUrl: String = "")

private suspend fun <T> Task<T>.await(): T = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { cont.resume(it) }
    addOnFailureListener { cont.resumeWithException(it) }
}
