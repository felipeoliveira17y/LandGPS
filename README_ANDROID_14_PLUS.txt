GPS Landmensure v13 - edição Android 14+

Revisão 2.3.2:
- Recupera automaticamente o rascunho local do levantamento em andamento.
- Permite editar o nome dos vértices e exportar/restaurar backup JSON.
- Salva CSV/KML/backup na pasta Downloads/GPS Landmensure usando o armazenamento do Android.

Compatibilidade intencional:
- minSdk 34 = Android 14 (não instala em Android 13 ou inferior)
- compileSdk 36 = Android 16
- targetSdk 36 = Android 16
- Java/Kotlin JVM 17

Permissões usadas:
- ACCESS_FINE_LOCATION (necessária para GNSS preciso)
- ACCESS_COARSE_LOCATION
- INTERNET (mapas)

O aplicativo coleta localização somente enquanto a Activity está visível. Não usa serviço de localização em segundo plano, portanto não requer FOREGROUND_SERVICE_LOCATION nem ACCESS_BACKGROUND_LOCATION para o funcionamento atual.

Ao instalar, conceda Localização e habilite "Usar localização precisa".
