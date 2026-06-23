package cz.hcasc.dagmar.core.files

import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream

class PdfExporter {
    suspend fun createAttendanceReport(header: String, lines: List<String>): ByteArray = withContext(Dispatchers.Default) {
        val document = PdfDocument()
        val pageInfo = PdfDocument.PageInfo.Builder(595, 842, 1).create()
        val page = document.startPage(pageInfo)

        val paint = Paint().apply {
            textSize = 14f
            isAntiAlias = true
        }
        val canvas: Canvas = page.canvas
        canvas.drawText(header, 40f, 40f, paint)
        var y = 70f
        paint.textSize = 11f
        for (line in lines) {
            canvas.drawText(line, 40f, y, paint)
            y += 18f
            if (y > 820f) break
        }

        document.finishPage(page)
        val output = ByteArrayOutputStream()
        document.writeTo(output)
        document.close()
        output.toByteArray()
    }
}
