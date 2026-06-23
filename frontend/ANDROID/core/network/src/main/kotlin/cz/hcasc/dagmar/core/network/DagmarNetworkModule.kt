package cz.hcasc.dagmar.core.network

import cz.hcasc.dagmar.core.auth.AdminCsrfStore
import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.ResponseBody
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Response
import retrofit2.Retrofit
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

private const val BASE_URL = "https://dagmar.hcasc.cz"
private val JSON = Json { ignoreUnknownKeys = true }
private val JSON_MEDIA_TYPE = "application/json".toMediaType()

@Module
@InstallIn(SingletonComponent::class)
object DagmarNetworkModule {
    @Provides
    @Singleton
    fun provideCookieJar(): CookieJar = object : CookieJar {
        private val cookieStore = mutableListOf<Cookie>()

        override fun loadForRequest(url: HttpUrl): List<Cookie> = cookieStore.filter { it.matches(url) }

        override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
            cookieStore.removeAll { old -> cookies.any { it.name == old.name && it.domain == old.domain } }
            cookieStore += cookies
        }
    }

    @Provides
    @Singleton
    fun provideCsrfInterceptor(adminCsrfStore: AdminCsrfStore): Interceptor = Interceptor { chain ->
        val request = chain.request()
        val token = runCatching { runBlocking { adminCsrfStore.token.first() } }.getOrNull()
        val builder = request.newBuilder()
        if (!token.isNullOrBlank()) {
            builder.header("X-CSRF-Token", token)
        }
        chain.proceed(builder.build())
    }

    @Provides
    @Singleton
    fun provideHttpClient(csrfInterceptor: Interceptor, cookieJar: CookieJar): OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .addInterceptor(csrfInterceptor)
        .addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    @Provides
    @Singleton
    fun provideRetrofit(client: OkHttpClient): Retrofit = Retrofit.Builder()
        .baseUrl(BASE_URL)
        .client(client)
        .addConverterFactory(JSON.asConverterFactory(JSON_MEDIA_TYPE))
        .build()

    @Provides
    @Singleton
    fun providePortalApi(retrofit: Retrofit): PortalApi = retrofit.create(PortalApi::class.java)

    @Provides
    @Singleton
    fun provideAttendanceApi(retrofit: Retrofit): AttendanceApi = retrofit.create(AttendanceApi::class.java)

    @Provides
    @Singleton
    fun provideAdminApi(retrofit: Retrofit): AdminApi = retrofit.create(AdminApi::class.java)
}

@Serializable
data class PortalLoginRequest(val email: String, val password: String)

@Serializable
data class PortalLoginResponse(
    val instance_token: String,
    val display_name: String? = null,
    val employment_id: Int? = null,
    val afternoon_cutoff: String? = null,
)

@Serializable
data class PortalResetRequest(val token: String, val password: String)

@Serializable
data class AttendanceDay(
    val date: String,
    val arrival_time: String? = null,
    val departure_time: String? = null,
    val planned_arrival_time: String? = null,
    val planned_departure_time: String? = null,
)

@Serializable
data class AttendanceMonthResponse(val days: List<AttendanceDay>)

@Serializable
data class AttendanceUpdateRequest(
    val employment_id: Int,
    val date: String,
    val arrival_time: String? = null,
    val departure_time: String? = null,
)

interface PortalApi {
    @POST("/api/v1/portal/login")
    suspend fun login(@Body request: PortalLoginRequest): PortalLoginResponse

    @POST("/api/v1/portal/reset")
    suspend fun resetPassword(@Body request: PortalResetRequest)
}

interface AttendanceApi {
    @GET("/api/v1/attendance")
    suspend fun month(
        @Query("employment_id") employmentId: Int,
        @Query("year") year: Int,
        @Query("month") month: String,
    ): AttendanceMonthResponse

    @PUT("/api/v1/attendance")
    suspend fun upsert(@Body request: AttendanceUpdateRequest)
}

@Serializable
data class ApiOk(val ok: Boolean = true)

@Serializable
data class AdminUserDto(
    val id: Int,
    val name: String,
    val email: String,
    val role: String,
    val has_password: Boolean,
    val is_active: Boolean = true,
)

@Serializable
data class UserListResponse(val users: List<AdminUserDto>)

@Serializable
data class NewUserRequest(val name: String, val email: String, val role: String)

@Serializable
data class UpdateUserRequest(
    val name: String? = null,
    val email: String? = null,
    val role: String? = null,
)

@Serializable
data class AdminInstance(val id: String, val display_name: String? = null)

@Serializable
data class AdminAttendanceMonthResponse(val days: List<AttendanceDay>, val locked: Boolean = false)

@Serializable
data class AdminAttendanceRequest(val employment_id: Int, val date: String, val arrival_time: String? = null, val departure_time: String? = null)

@Serializable
data class LockMonthRequest(val employment_id: Int, val year: Int, val month: Int)

@Serializable
data class AdminEmploymentMeta(
    val id: Int,
    val user_id: Int,
    val user_name: String,
    val title: String,
    val employment_type: String,
    val display_label: String,
    val start_date: String,
    val end_date: String? = null,
)

@Serializable
data class ShiftPlanDay(
    val date: String,
    val arrival_time: String? = null,
    val departure_time: String? = null,
    val status: String? = null,
)

@Serializable
data class ShiftPlanRow(
    val employment_id: Int,
    val user_name: String,
    val title: String,
    val employment_type: String,
    val display_label: String,
    val days: List<ShiftPlanDay>,
)

@Serializable
data class ShiftPlanMonthResponse(
    val year: Int,
    val month: Int,
    val selected_employment_ids: List<Int> = emptyList(),
    val available_employments: List<AdminEmploymentMeta> = emptyList(),
    val rows: List<ShiftPlanRow> = emptyList(),
)

@Serializable
data class ShiftPlanSelectionRequest(val year: Int, val month: Int, val employment_ids: List<Int>)

@Serializable
data class ShiftPlanUpsertRequest(
    val employment_id: Int,
    val date: String,
    val arrival_time: String? = null,
    val departure_time: String? = null,
    val status: String? = null,
)

@Serializable
data class SmtpSettings(
    val host: String? = null,
    val port: Int? = null,
    val security: String? = null,
    val username: String? = null,
    val from_email: String? = null,
    val from_name: String? = null,
    val password_set: Boolean = false,
)

interface AdminApi {
    @GET("/api/v1/admin/me")
    suspend fun me(): ApiOk

    @GET("/api/v1/admin/csrf")
    suspend fun csrf(): ApiOk

    @POST("/api/v1/admin/login")
    suspend fun login(@Body body: Map<String, String>)

    @POST("/api/v1/admin/logout")
    suspend fun logout(): ApiOk

    @GET("/api/v1/admin/users")
    suspend fun listUsers(): UserListResponse

    @POST("/api/v1/admin/users")
    suspend fun createUser(@Body request: NewUserRequest): AdminUserDto

    @PUT("/api/v1/admin/users/{id}")
    suspend fun updateUser(@Path("id") id: Int, @Body request: UpdateUserRequest): AdminUserDto

    @POST("/api/v1/admin/users/{id}/send-reset")
    suspend fun sendReset(@Path("id") id: Int): ApiOk

    @GET("/api/v1/admin/attendance")
    suspend fun getAttendance(
        @Query("employment_id") employmentId: Int,
        @Query("year") year: Int,
        @Query("month") month: String,
    ): AdminAttendanceMonthResponse

    @PUT("/api/v1/admin/attendance")
    suspend fun upsertAttendance(@Body request: AdminAttendanceRequest): ApiOk

    @POST("/api/v1/admin/attendance/lock")
    suspend fun lockMonth(@Body request: LockMonthRequest): ApiOk

    @POST("/api/v1/admin/attendance/unlock")
    suspend fun unlockMonth(@Body request: LockMonthRequest): ApiOk

    @GET("/api/v1/admin/shift-plan")
    suspend fun getShiftPlan(@Query("year") year: Int, @Query("month") month: String): ShiftPlanMonthResponse

    @PUT("/api/v1/admin/shift-plan")
    suspend fun upsertShiftPlan(@Body request: ShiftPlanUpsertRequest): ApiOk

    @PUT("/api/v1/admin/shift-plan/selection")
    suspend fun setShiftPlanSelection(@Body request: ShiftPlanSelectionRequest): ApiOk

    @GET("/api/v1/admin/export")
    @Streaming
    suspend fun export(
        @Query("month") month: String,
        @Query("employment_id") employmentId: Int? = null,
        @Query("bulk") bulk: Boolean? = null,
    ): Response<ResponseBody>

    @GET("/api/v1/admin/smtp")
    suspend fun smtp(): SmtpSettings

    @PUT("/api/v1/admin/smtp")
    suspend fun updateSmtp(@Body settings: SmtpSettings): SmtpSettings
}
