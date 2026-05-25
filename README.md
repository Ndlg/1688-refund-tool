# 1688 退款详情工具

这个工具现在主要在 Edge 扩展里使用：

- `edge-extension/`：Edge 扩展，点击扩展图标后打开工具面板。
- 工具面板可以扫描当前 1688 退款列表页，提取 `TQ...,售中/售后`，并按模板生成详情链接。

## 第一次安装扩展

1. 打开 Edge，地址栏输入 `edge://extensions/`。
2. 打开“开发人员模式”。
3. 点“加载解压缩的扩展”。
4. 选择本工具里的 `edge-extension` 文件夹。

## 使用流程

1. 打开 1688 退款列表页。
2. 右下角出现 `1688 Detail Helper`。
3. 点 `Collect IDs`，确认文本框里出现类似：

   ```text
   TQ389820025461522394,售中
   TQ390187191123691935,售后
   ```

4. 点 `Copy IDs`。
5. 点浏览器右上角扩展图标，打开“1688 退款详情工具”。
6. 填两个模板：

   售中模板示例：

   ```text
   https://dispute.1688.com/refund/assureRefundDetail.htm?refundId=某个TQ单号&spm=0.0&userType=seller
   ```

   售后模板示例：

   ```text
   https://dispute.1688.com/refund/aftersaleDetail.htm?refundId=某个TQ单号&spm=0.0&userType=seller
   ```

7. 点“扫描当前页”。
8. 点“生成链接”。
9. 点“逐个打开”或“复制链接”。

## 注意

- 扩展不点击“同意退款”“拒绝退款”。
- 工具只按你提供的成功详情页 URL 替换退款单号。
- 不要使用错误页 URL 作为模板，例如带 `tradeFlowError.htm` 的 URL。
