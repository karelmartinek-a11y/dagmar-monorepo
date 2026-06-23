package cz.hcasc.dagmar.core.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavArgument
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import cz.hcasc.dagmar.feature.employeeattendance.EmployeeAttendanceScreen
import cz.hcasc.dagmar.feature.employeeauth.EmployeeLoginScreen
import cz.hcasc.dagmar.feature.passwordreset.PasswordResetScreen

object DaymarRoutes {
    const val EmployeeLogin = "employee/login"
    const val EmployeeAttendance = "employee/attendance"
    const val PasswordReset = "password/reset/{token}"
}

@Composable
fun DagmarNavGraph(modifier: Modifier = Modifier) {
    val navController = rememberNavController()
    NavHost(navController = navController, startDestination = DaymarRoutes.EmployeeLogin, modifier = modifier) {
        composable(DaymarRoutes.EmployeeLogin) {
            EmployeeLoginScreen(onLoggedIn = { navController.navigate(DaymarRoutes.EmployeeAttendance) })
        }
        composable(DaymarRoutes.EmployeeAttendance) {
            EmployeeAttendanceScreen(onOpenReset = { navController.navigate("password/reset/" + "") }, onLogout = { navController.navigate(DaymarRoutes.EmployeeLogin) })
        }
        composable(
            route = DaymarRoutes.PasswordReset,
            arguments = listOf(navArgument("token") { type = NavType.StringType; defaultValue = "" })
        ) { backStackEntry ->
            val token = backStackEntry.arguments?.getString("token") ?: ""
            PasswordResetScreen(token = token, onComplete = { navController.navigate(DaymarRoutes.EmployeeLogin) })
        }
    }
}
