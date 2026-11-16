;(function () {
  var theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  try {
    var savedTheme = localStorage.getItem('pdfcraft.theme')
    if (savedTheme === 'light' || savedTheme === 'dark') theme = savedTheme
  } catch (e) {}
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#14121A' : '#241259'
})()
