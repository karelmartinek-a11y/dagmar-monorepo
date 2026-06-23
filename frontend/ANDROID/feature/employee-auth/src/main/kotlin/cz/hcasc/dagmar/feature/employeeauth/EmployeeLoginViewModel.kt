package cz.hcasc.dagmar.feature.employeeauth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cz.hcasc.dagmar.core.data.PortalRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val isLoading: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class EmployeeLoginViewModel @Inject constructor(private val portalRepository: PortalRepository) : ViewModel() {
    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState

    fun updateEmail(email: String) = _uiState.update { it.copy(email = email) }
    fun updatePassword(password: String) = _uiState.update { it.copy(password = password) }

    fun login(onSuccess: () -> Unit) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoading = true, error = null)
            try {
                portalRepository.login(_uiState.value.email.trim(), _uiState.value.password)
                onSuccess()
            } catch (t: Throwable) {
                _uiState.value = _uiState.value.copy(error = t.localizedMessage ?: "Login failed")
            } finally {
                _uiState.value = _uiState.value.copy(isLoading = false)
            }
        }
    }
}
