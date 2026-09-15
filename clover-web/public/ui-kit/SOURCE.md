# UI-kit платформы: источники

Слой внешнего стиля дашбордов РШУ. Подключение на странице (после Bootstrap и shared.css):

```html
<link rel="stylesheet" href="/ui-kit/ds.css">
<script src="/ui-kit/ds.js"></script>   <!-- после chart.js, если на странице есть графики -->
```

Образец всех элементов: `/ui-kit/preview.html`.

## Что взято из RSU/UI-kit

Репозиторий `http://185.75.88.222:3000/RSU/UI-kit.git`, ветка `feature/kit-components`,
коммит `cead924` (08.09.2026).

| Файл здесь | Источник в ките | Изменения |
|---|---|---|
| `tokens.css` (блок "из кита") | `src/styles/tokens.css` | только продуктовые переменные; без служебных переменных витрины и утилит `.p-*`, `.rounded-*` |
| `fonts/*.woff2`, `fonts/WixMadeforDisplay-Bold.ttf` | `src/styles/fonts/` | только 400/500/600 woff2 и 700 ttf |
| `fonts.css` | `src/styles/fonts.css` | только woff2 (и ttf для 700) |
| `icons.svg` (символы `icon-*`) | `src/assets/icons-sprite.svg` | заливка переведена на `currentColor` |
| `logo.svg`, `logo-white.svg` | логотип из `src/components/header/header.html` | `logo.svg` перекрашен в `#093EB4` |
| стиль кнопок, табов, полей, селекта, чекбокса, переключателя, бейджей в `ds.css` | `src/components/{button,tabs,input-text,select,checkbox,toggle,badge}` | размеры уменьшены под плотность дашбордов, цвета и радиусы из кита |

## Что сделано здесь (в ките нет)

- Таблицы, KPI-плитки, верхняя панель, плитки-ссылки, модальное окно, уведомление, мост Bootstrap 5.3.
- Иконки интерфейса `i-*` в `icons.svg` (контур 2px).
- Палитра графиков `--ds-chart-1..8` из цветов палитры кита и тема Chart.js в `ds.js`.

Лицензия шрифта Wix Madefor Display - SIL Open Font License 1.1.
