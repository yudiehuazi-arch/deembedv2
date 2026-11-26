/* ============================================================================
 * shape-preview-canvas.js —— Shape 真实轮廓预览（直线与扫掠圆弧）
 * ========================================================================== */
(function (root) {
  "use strict";

  function resolveShapePreview(template) {
    if (!template) return null;
    if (Array.isArray(template.boundary)) return template;
    var rawText = typeof template.rawShapeText === 'string'
      ? template.rawShapeText
      : (typeof template.rawTxt === 'string' ? template.rawTxt : null);
    var checker = root.PourChecker;
    if (rawText != null) {
      if (!rawText.trim() || !checker || !checker.parsePcbElements) return null;
      try {
        var parsed = checker.parsePcbElements(rawText);
        template.shape = checker.composeShapeItems
          ? checker.composeShapeItems(parsed.shapes)
          : (parsed.shapes && parsed.shapes.length ? parsed.shapes[0] : null);
      } catch (_) {
        template.shape = null;
      }
      return template.shape;
    }
    return template.shape || null;
  }

  function getShapeRings(shape) {
    if (!shape) return [];
    var checker = root.PourChecker;
    if (checker && checker.shapeRings) return checker.shapeRings(shape);
    var exterior = Array.isArray(shape._ring) && shape._ring.length >= 3
      ? shape._ring
      : (checker && checker.flattenBoundary ? checker.flattenBoundary(shape) : []);
    return exterior.length >= 3 ? [exterior] : [];
  }

  function getShapeRingGroups(shape) {
    var components = shape && Array.isArray(shape.components) && shape.components.length
      ? shape.components : [shape];
    return components.map(getShapeRings).filter(function (rings) {
      return rings.length && rings[0].length >= 3;
    });
  }

  function drawShapePreviewCanvas(canvas, shape) {
    if (!canvas || !canvas.getContext) return false;
    var ctx = canvas.getContext('2d');
    if (!ctx) return false;
    var width = canvas.width;
    var height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, width, height);

    var ringGroups = getShapeRingGroups(shape);
    if (!ringGroups.length) return false;
    var allRings = [];
    ringGroups.forEach(function (rings) { Array.prototype.push.apply(allRings, rings); });
    var allPoints = [];
    allRings.forEach(function (ring) { Array.prototype.push.apply(allPoints, ring); });
    var xs = allPoints.map(function (point) { return point[0]; });
    var ys = allPoints.map(function (point) { return point[1]; });
    var minX = Math.min.apply(null, xs);
    var maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys);
    var maxY = Math.max.apply(null, ys);
    var centerX = (minX + maxX) / 2;
    var centerY = (minY + maxY) / 2;
    var padding = Math.max(4, Math.min(12, Math.min(width, height) * 0.11));
    var scale = Math.min(
      (width - padding * 2) / Math.max(maxX - minX, 1),
      (height - padding * 2) / Math.max(maxY - minY, 1)
    );
    function project(point) {
      return {
        x: width / 2 + (point[0] - centerX) * scale,
        y: height / 2 - (point[1] - centerY) * scale
      };
    }

    ctx.fillStyle = 'rgba(180, 83, 9, 0.35)';
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    ringGroups.forEach(function (rings) {
      ctx.beginPath();
      rings.forEach(function (contourRing) {
        contourRing.forEach(function (point, index) {
          var screen = project(point);
          if (index === 0) ctx.moveTo(screen.x, screen.y);
          else ctx.lineTo(screen.x, screen.y);
        });
        ctx.closePath();
      });
      ctx.fill('evenodd');
      ctx.stroke();
    });

    if (shape.centroid) {
      var centroid = project([shape.centroid.x, shape.centroid.y]);
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(centroid.x, centroid.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    return true;
  }

  root.resolveShapePreview = resolveShapePreview;
  root.drawShapePreviewCanvas = drawShapePreviewCanvas;
})(typeof window !== "undefined" ? window : globalThis);
