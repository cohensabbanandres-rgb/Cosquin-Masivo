<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vote</title>
  <link rel="stylesheet" href="assets/styles.css?v=777" />
</head>
<body>
  <div class="container">
    <a href="index.html">← Home</a>
    <h1 id="title">Loading…</h1>

    <div id="error" class="error" style="display:none;"></div>
    <div id="grid" class="card">Cargando grilla…</div>
  </div>

  <!-- IMPORTANTE: usa el nuevo nombre para romper cache -->
  <script src="assets/app-v2.js?v=777"></script>
  <script>
    // Garantiza que existe y ejecuta
    if (!window.CosquinApp) {
      const e = document.getElementById("error");
      e.style.display = "block";
      e.textContent = "ERROR: app-v2.js cargó pero NO exportó window.CosquinApp";
    } else {
      window.CosquinApp.initVotePage();
    }
  </script>
</body>
</html>
