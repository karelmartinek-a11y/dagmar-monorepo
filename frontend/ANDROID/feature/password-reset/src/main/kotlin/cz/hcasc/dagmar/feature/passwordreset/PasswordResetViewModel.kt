package cz.hcasc.dagmar.feature.passwordreset

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import cz.hcasc.dagmar.core.data.PortalRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class PasswordResetState(
    val password: String = "",
    val isLoading: Boolean = false,
    val success: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class PasswordResetViewModel @Inject constructor(private val portalRepository: PortalRepository) : ViewModel() {
    private val _state = MutableStateFlow(PasswordResetState())
    val state: StateFlow<PasswordResetState> = _state

    fun updatePassword(value: String) = _state.update { it.copy(password = value) }

    fun submit(token: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(isLoading = true, error = null)
            try {
                portalRepository.resetPassword(token, _state.value.password)
                _state.value = _state.value.copy(success = true)
            } catch (t: Throwable) {
                _state.value = _state.value.copy(error = t.localizedMessage ?: "Nelze uložit")
            } finally {
                _state.value = _state.value.copy(isLoading = false)
            }
        }
    }
}
