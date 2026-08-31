//动态标题
(function () {
  let originTitle = document.title;
  let titleTime;
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      //离开当前页面时标签显示内容
      document.title = "👀诶,人nei~";
      clearTimeout(titleTime);
    } else {
      //返回当前页面时标签显示内容
      document.title = "🥰来啦老弟～"; //两秒后变回正常标题
      titleTime = setTimeout(function () {
        document.title = originTitle;
      }, 2000);
    }
  });
})();
