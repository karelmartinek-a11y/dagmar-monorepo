package cz.hcasc.dagmar.feature.employeeattendance

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import cz.hcasc.dagmar.core.network.AttendanceDay
import java.time.YearMonth

@Composable
fun EmployeeAttendanceScreen(
    onOpenReset: () -> Unit,
    onLogout: () -> Unit,
    viewModel: EmployeeAttendanceViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    Column(modifier = Modifier.padding(16.dp)) {
        Header(state, onOpenReset, onLogout)
        Spacer(modifier = Modifier.height(12.dp))
        MonthControls(state.month, onNext = { viewModel.refreshMonth(state.month.plusMonths(1)) }, onPrev = { viewModel.refreshMonth(state.month.minusMonths(1)) })
        Spacer(modifier = Modifier.height(12.dp))
        if (state.isLoading) {
            Text("Načítám…", style = MaterialTheme.typography.bodyMedium)
        }
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(state.rows) { row ->
                AttendanceRow(row, onCommit = { viewModel.syncAttendance(row.copy(arrival_time = it.first, departure_time = it.second)) })
            }
        }
    }
}

@Composable
private fun Header(state: AttendanceUiState, onReset: () -> Unit, onLogout: () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Text("Docházka", style = MaterialTheme.typography.headlineSmall)
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Fronta: ${state.queued}")
            Row {
                Button(onClick = onReset) { Text("Reset") }
                Spacer(modifier = Modifier.width(8.dp))
                Button(onClick = onLogout) { Text("Odhlásit") }
            }
        }
    }
}

@Composable
private fun MonthControls(month: YearMonth, onPrev: () -> Unit, onNext: () -> Unit) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Button(onClick = onPrev) { Text("<-") }
        Text(month.toString(), style = MaterialTheme.typography.bodyLarge)
        Button(onClick = onNext) { Text("->") }
    }
}

@Composable
private fun AttendanceRow(row: AttendanceDay, onCommit: (Pair<String?, String?>) -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp)) {
            Text(row.date, style = MaterialTheme.typography.bodyLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = row.arrival_time ?: "",
                    onValueChange = { onCommit(it to row.departure_time) },
                    label = { Text("Příchod") },
                    keyboardOptions = KeyboardOptions.Default.copy(imeAction = ImeAction.Next, keyboardType = KeyboardType.Number),
                    keyboardActions = KeyboardActions(onDone = { onCommit(row.arrival_time to row.departure_time) })
                )
                OutlinedTextField(
                    value = row.departure_time ?: "",
                    onValueChange = { onCommit(row.arrival_time to it) },
                    label = { Text("Odchod") },
                    keyboardOptions = KeyboardOptions.Default.copy(imeAction = ImeAction.Done, keyboardType = KeyboardType.Number),
                )
            }
        }
    }
}
