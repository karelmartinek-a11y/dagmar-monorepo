package cz.hcasc.dagmar.feature.passwordreset

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@Composable
fun PasswordResetScreen(token: String, onComplete: () -> Unit, viewModel: PasswordResetViewModel = hiltViewModel()) {
    val state by viewModel.state.collectAsState()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text("Nové heslo", style = MaterialTheme.typography.headlineSmall)
        OutlinedTextField(
            value = state.password,
            onValueChange = { viewModel.updatePassword(it) },
            label = { Text("Heslo") },
            modifier = Modifier.fillMaxWidth(),
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions.Default.copy(imeAction = ImeAction.Done),
        )
        state.error?.let {
            Text(it, color = MaterialTheme.colorScheme.error)
        }
        if (state.success) {
            LaunchedEffect(Unit) { onComplete() }
            Text("Heslo bylo nastaveno.", color = MaterialTheme.colorScheme.secondary)
        }
        Button(
            onClick = { viewModel.submit(token) },
            enabled = !state.isLoading && !state.success,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (state.isLoading) "Ukládám…" else "Uložit")
        }
    }
}
