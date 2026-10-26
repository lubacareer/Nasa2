import { useEffect, useRef } from 'react';
import { init, use as registerCharts, type EChartsCoreOption, type EChartsType } from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, MarkLineComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

registerCharts([BarChart, LineChart, GridComponent, MarkLineComponent, SVGRenderer]);

interface EChartProps {
  option: EChartsCoreOption;
  label: string;
  className: string;
  testId?: string;
}

/** The adapter alone owns ECharts instances and their resize/disposal lifecycle. */
export function EChart({ option, label, className, testId }: EChartProps) {
  const element = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);

  useEffect(() => {
    if (!element.current) return;
    const instance = init(element.current, undefined, { renderer: 'svg' });
    chart.current = instance;
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={element} className={`chart ${className}`} role="img" aria-label={label} data-testid={testId} />;
}
