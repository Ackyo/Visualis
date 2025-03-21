/*
 * <<
 * Davinci
 * ==
 * Copyright (C) 2016 - 2017 EDP
 * ==
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * >>
 */

import React, { createRef, RefObject } from 'react'
import { RouteComponentProps } from 'react-router'
import Helmet from 'react-helmet'
import { connect } from 'react-redux'
import { createStructuredSelector } from 'reselect'

import { compose } from 'redux'
import injectReducer from 'utils/injectReducer'
import injectSaga from 'utils/injectSaga'
import reducer from './reducer'
import saga from './sagas'

import { FieldSortTypes } from 'containers/Widget/components/Config/Sort'
import { widgetDimensionMigrationRecorder } from 'utils/migrationRecorders'
import { message } from 'antd'

import Login from '../../components/Login/index'
import LayerItem from 'app/containers/Display/components/LayerItem'
import { RenderType, IWidgetConfig } from 'app/containers/Widget/components/Widget'
import { decodeMetricName } from 'app/containers/Widget/components/util'
import HeadlessBrowserIdentifier from '../../components/HeadlessBrowserIdentifier'

const mainStyles = require('app/containers/Main/Main.less')
const styles = require('app/containers/Display/Display.less')

import ShareDisplayActions from './actions'
const { getBaseInfo, loadDisplay, loadLayerData, executeQuery, getProgress, getResult } = ShareDisplayActions
import {
  makeSelectTitle,
  makeSelectDisplay,
  makeSelectSlide,
  makeSelectLayers,
  makeSelectWidgets,
  makeSelectLayersInfo
} from './selectors'
import { IQueryConditions, IDataRequestParams } from '../../../app/containers/Dashboard/Grid'
import { DashboardItemStatus } from '../Dashboard'
import { GraphTypes } from 'app/containers/Display/components/util'

interface IDisplayProps extends RouteComponentProps<{}, {}> {
  title: string
  display: any
  slide: any
  layers: any
  widgets: any
  layersInfo: {
    [key: string]: {
      datasource: {
        columns: any[]
        pageNo: number
        pageSize: number
        resultList: any[]
        totalCount: number
      }
      status: DashboardItemStatus
      loading: boolean
      queryConditions: IQueryConditions
      downloadCsvLoading: boolean
      interactId: string
      renderType: RenderType
    }
  }
  onLoadDisplay: (token, resolve, reject) => void
  onLoadLayerData: (
    renderType: RenderType,
    layerId: number,
    dataToken: string,
    requestParams: IDataRequestParams
  ) => void
  onExecuteQuery: (
    renderType: RenderType,
    layerId: number,
    dataToken: string,
    requestParams: IDataRequestParams,
    resolve: (data) => void,
    reject: (data) => void,
    parameters: string
    ) => void
  onGetProgress: (
    execId: string,
    resolve: (data) => void,
    reject: (data) => void
    ) => void
  onGetResult: (
    execId: string,
    renderType: RenderType,
    layerId: number,
    dataToken: string,
    requestParams: IDataRequestParams,
    resolve: (data) => void,
    reject: (data) => void
    ) => void
    onGetBaseInfo: (resolve) => any
}

interface IDisplayStates {
  scale: [number, number]
  showLogin: boolean
  shareInfo: string
  parameters: string
  headlessBrowserRenderSign: boolean
  WidgetExecuteFailedTag: boolean
  executeQueryFailed: boolean
}

export class Display extends React.Component<IDisplayProps, IDisplayStates> {

  private charts: object = {}
  private displayCanvas: RefObject<HTMLDivElement> = createRef()

  public constructor (props) {
    super(props)
    this.state = {
      scale: [1, 1],
      showLogin: false,
      shareInfo: '',
      parameters: '',
      headlessBrowserRenderSign: false,
      WidgetExecuteFailedTag: false,
      executeQueryFailed: false
    }
  }

  public componentWillMount () {
    const { shareInfo, parameters } = this.props.location.query
    this.props.onGetBaseInfo(result => {
      localStorage.setItem('username', result.username)
    })
    this.setState({
      shareInfo,
      parameters: parameters ? parameters : ''
    }, () => {
      this.loadShareContent()
    })
  }

  public componentWillUnmount () {
    this.timeout.forEach(item => clearTimeout(item))
  }

  public componentWillReceiveProps (nextProps: IDisplayProps) {
    const { slide, layers, layersInfo } = nextProps
    const { scale } = this.state
    const [scaleWidth, scaleHeight] = scale
    if (slide) {
      const { slideParams } = JSON.parse(slide.config)

      if (slideParams && slideParams.displayMode) {
        this.setDisplayMode(slideParams.displayMode)
      }
    }

    if (slide && this.props.slide !== slide) {
      const { slideParams } = JSON.parse(slide.config)
      const { scaleMode, width, height } = slideParams
      const { clientHeight, clientWidth } = document.body
      let nextScaleHeight = 1
      let nextScaleWidth = 1
      switch (scaleMode) {
        case 'scaleHeight':
          nextScaleWidth = nextScaleHeight = clientHeight / height
          break
        case 'scaleWidth':
          nextScaleHeight = nextScaleWidth = clientWidth / width
          break
        case 'scaleFull':
          nextScaleHeight = clientHeight / height
          nextScaleWidth = clientWidth / width
      }
      if (scaleHeight !== nextScaleHeight || scaleWidth !== nextScaleWidth) {
        this.setState({ scale: [nextScaleWidth, nextScaleHeight] })
      }
    }
    if (layersInfo) {
      const widgetLayers = layers.filter((layer) => layer.type === GraphTypes.Chart)
      const initialedItems = Object.entries(layersInfo)
        .filter(([key, info]) => {
          return widgetLayers.find((layer) => layer.id === Number(key))
            && [DashboardItemStatus.Fulfilled, DashboardItemStatus.Error].includes(info.status)
        })
      if (initialedItems.length === widgetLayers.length) {
        setTimeout(() => {
          this.setState({
            headlessBrowserRenderSign: true
          })
        }, 5000)
      }
    }
  }

  // 设置展示模式为静态模式或者是动态模式
  private setDisplayMode = (value) => {
    const widgetDOMs = document.getElementsByClassName('widget-class')
    const paginationDOMs = document.getElementsByClassName('ant-pagination')
    const tableHeaderDOMs = document.getElementsByClassName('ant-table-header')
    const tableBodyDOMs = document.getElementsByClassName('ant-table-body')
    const tableWrapperDOMs = document.getElementsByClassName('ant-table-wrapper')
    if (value === 'static') {
      // 静态模式，隐藏掉所有滚动条和分页组件
      for (let i = 0; i < widgetDOMs.length; i++) {
        widgetDOMs[i].style.overflow = 'hidden'
      }
      for (let i = 0; i < tableHeaderDOMs.length; i++) {
        tableHeaderDOMs[i].style.setProperty('overflow', 'hidden', 'important')
      }
      for (let i = 0; i < tableBodyDOMs.length; i++) {
        tableBodyDOMs[i].style.overflow = 'hidden'
      }
      for (let i = 0; i < tableWrapperDOMs.length; i++) {
        tableWrapperDOMs[i].style.overflow = 'hidden'
      }
      for (let i = 0; i < paginationDOMs.length; i++) {
        paginationDOMs[i].style.display = 'none'
      }
    } else {
      // 动态模式 恢复原值
      for (let i = 0; i < widgetDOMs.length; i++) {
        widgetDOMs[i].style.overflow = 'auto hidden'
      }
      for (let i = 0; i < tableHeaderDOMs.length; i++) {
        tableHeaderDOMs[i].style.overflow = ''
        tableHeaderDOMs[i].style.overflowX = 'hidden !important'
        tableHeaderDOMs[i].style.overflowY = 'scroll !important'
      }
      for (let i = 0; i < tableBodyDOMs.length; i++) {
        tableBodyDOMs[i].style.overflow = ''
        tableBodyDOMs[i].style.overflowY = 'auto'
      }
      for (let i = 0; i < tableWrapperDOMs.length; i++) {
        tableWrapperDOMs[i].style.overflowY = 'scroll'
        tableWrapperDOMs[i].style.overflow = ''
      }
      for (let i = 0; i < paginationDOMs.length; i++) {
        paginationDOMs[i].style.display = ''
      }
    }
  }

  private getChartData = (renderType: RenderType, itemId: number, widgetId: number, queryConditions?: Partial<IQueryConditions>) => {
    const {
      widgets,
      layersInfo,
      onLoadLayerData,
      onExecuteQuery
    } = this.props

    const widget = widgets.find((w) => w.id === widgetId)
    const widgetConfig: IWidgetConfig = JSON.parse(widget.config)
    const { cols, rows, metrics, secondaryMetrics, filters, color, label, size, xAxis, tip, orders, cache, expired, view, engine } = widgetConfig
    const updatedCols = cols.map((col) => widgetDimensionMigrationRecorder(col))
    const updatedRows = rows.map((row) => widgetDimensionMigrationRecorder(row))
    const customOrders = updatedCols.concat(updatedRows)
      .filter(({ sort }) => sort && sort.sortType === FieldSortTypes.Custom)
      .map(({ name, sort }) => ({ name, list: sort[FieldSortTypes.Custom].sortList }))

    const cachedQueryConditions = layersInfo[itemId].queryConditions

    let tempFilters
    let linkageFilters
    let globalFilters
    let tempOrders
    let variables
    let linkageVariables
    let globalVariables
    let pagination
    let nativeQuery

    if (queryConditions) {
      tempFilters = queryConditions.tempFilters !== void 0 ? queryConditions.tempFilters : cachedQueryConditions.tempFilters
      linkageFilters = queryConditions.linkageFilters !== void 0 ? queryConditions.linkageFilters : cachedQueryConditions.linkageFilters
      globalFilters = queryConditions.globalFilters !== void 0 ? queryConditions.globalFilters : cachedQueryConditions.globalFilters
      tempOrders = queryConditions.orders !== void 0 ? queryConditions.orders : cachedQueryConditions.orders
      variables = queryConditions.variables || cachedQueryConditions.variables
      linkageVariables = queryConditions.linkageVariables || cachedQueryConditions.linkageVariables
      globalVariables = queryConditions.globalVariables || cachedQueryConditions.globalVariables
      pagination = queryConditions.pagination || cachedQueryConditions.pagination
      nativeQuery = queryConditions.nativeQuery || cachedQueryConditions.nativeQuery
    } else {
      tempFilters = cachedQueryConditions.tempFilters
      linkageFilters = cachedQueryConditions.linkageFilters
      globalFilters = cachedQueryConditions.globalFilters
      tempOrders = cachedQueryConditions.orders
      variables = cachedQueryConditions.variables
      linkageVariables = cachedQueryConditions.linkageVariables
      globalVariables = cachedQueryConditions.globalVariables
      pagination = cachedQueryConditions.pagination
      nativeQuery = cachedQueryConditions.nativeQuery
    }

    let groups = cols.concat(rows).filter((g) => g.name !== '指标名称').map((g) => g.name)
    let aggregators =  metrics.map((m) => ({
      column: decodeMetricName(m.name),
      func: m.agg
    }))

    if (secondaryMetrics && secondaryMetrics.length) {
      aggregators = aggregators.concat(secondaryMetrics.map((second) => ({
        column: decodeMetricName(second.name),
        func: second.agg
      })))
    }

    if (color) {
      groups = groups.concat(color.items.map((c) => c.name))
    }
    if (label) {
      groups = groups.concat(label.items
        .filter((l) => l.type === 'category')
        .map((l) => l.name))
      aggregators = aggregators.concat(label.items
        .filter((l) => l.type === 'value')
        .map((l) => ({
          column: decodeMetricName(l.name),
          func: l.agg
        })))
    }
    if (size) {
      aggregators = aggregators.concat(size.items
        .map((s) => ({
          column: decodeMetricName(s.name),
          func: s.agg
        })))
    }
    if (xAxis) {
      aggregators = aggregators.concat(xAxis.items
        .map((l) => ({
          column: decodeMetricName(l.name),
          func: l.agg
        })))
    }
    if (tip) {
      aggregators = aggregators.concat(tip.items
        .map((t) => ({
          column: decodeMetricName(t.name),
          func: t.agg
        })))
    }

    const requestParamsFilters = filters.reduce((a, b) => {
      return a.concat(b.config.sqlModel)
    }, [])

    const requestParams = {
      groups: Array.from(new Set(groups)),
      aggregators,
      filters: requestParamsFilters,
      tempFilters,
      linkageFilters,
      globalFilters,
      variables,
      linkageVariables,
      globalVariables,
      orders,
      cache,
      expired,
      flush: renderType === 'flush',
      pagination,
      nativeQuery,
      customOrders
    }

    if (typeof view === 'object' && Object.keys(view).length > 0) requestParams.view = view

    if (engine) requestParams.engineType = engine

    if (tempOrders) {
      requestParams.orders = requestParams.orders.concat(tempOrders)
    }

    // onLoadLayerData(
    //   renderType,
    //   itemId,
    //   widget.dataToken,
    //   requestParams
    // )
    this.setState({executeQueryFailed: false})
    onExecuteQuery(renderType, itemId, widget.dataToken, requestParams, (result) => {
      const { execId } = result
      this.executeQuery(execId, renderType, itemId, widget.dataToken, requestParams, this)
    }, () => {
      this.setState({executeQueryFailed: true})
      return message.error('查询失败！')
    }, this.state.parameters)
  }

  private timeout = []

  private executeQuery(execId, renderType, itemId, dataToken, requestParams, that) {
    const { onGetProgress, onGetResult } = that.props
    // 空数据的话，会不请求数据，execId为undefined，这时候不需要getProgress
    if (execId) {
      onGetProgress(execId, (result) => {
        const { progress, status } = result
        if (status === 'Failed') {
          // 提示 查询失败（显示表格头，就和现在的暂无数据保持一致的交互，只是提示换成“查询失败”）
          that.setState({executeQueryFailed: true, WidgetExecuteFailedTag: true})
          return message.error('查询失败！')
        } else if (status === 'Succeed' && progress === 1) {
          // 查询成功，调用 结果集接口，status为success时，progress一定为1
          onGetResult(execId, renderType, itemId, dataToken, requestParams, (result) => {
          }, () => {
            that.setState({executeQueryFailed: true})
            return message.error('查询失败！')
          })
        } else {
          // 说明还在运行中
          // 三秒后再请求一次进度查询接口
          const t = setTimeout(that.executeQuery, 3000, execId, renderType, itemId, dataToken, requestParams, that)
          that.timeout.push(t)
        }
      }, () => {
        that.setState({executeQueryFailed: true})
        return message.error('查询失败！')
      })
    }
  }

  private getPreviewStyle = (slideParams) => {
    const { scaleMode } = slideParams
    const previewStyle: React.CSSProperties = {}
    switch (scaleMode) {
      case 'scaleWidth':
        previewStyle.overflowY = 'auto'
        break
      case 'scaleHeight':
        previewStyle.overflowX = 'auto'
        break
      case 'noScale':
        previewStyle.overflow = 'auto'
        break
      case 'scaleFull':
      default:
        break
    }
    return previewStyle
  }

  private getSlideStyle = (slideParams, scale: [number, number]) => {
    const {
      width,
      height,
      scaleMode,
      backgroundColor,
      backgroundImage
    } = slideParams

    let slideStyle: React.CSSProperties

    const { clientWidth, clientHeight } = document.body
    const [scaleX, scaleY] = scale

    let translateX = (scaleX - 1) / 2
    let translateY = (scaleY - 1) / 2
    translateX += Math.max(0, (clientWidth - scaleX * width) / (2 * width))
    translateY += Math.max(0, (clientHeight - scaleY * height) / (2 * height))

    const translate = `translate(${translateX * 100}%, ${translateY * 100}%)`

    slideStyle  = {
      overflow: 'visible',
      width,
      height,
      transform: `${translate} scale(${scaleX}, ${scaleY})`
    }

    let backgroundStyle: React.CSSProperties | CSSStyleDeclaration = slideStyle
    if (scaleMode === 'scaleWidth' && screen.width <= 1024) {
      backgroundStyle = document.body.style
    }
    backgroundStyle.backgroundSize = 'cover'

    if (backgroundColor) {
      const rgb = backgroundColor.join()
      backgroundStyle.backgroundColor = `rgba(${rgb})`
    }
    if (backgroundImage) {
      backgroundStyle.backgroundImage = `url("${backgroundImage}")`
    }
    return slideStyle
  }

  private loadShareContent = () => {
    const { onLoadDisplay } = this.props
    const { shareInfo } = this.state
    onLoadDisplay(shareInfo, () => {
      console.log('share page need login...')
    }, () => {
      message.error('您无权访问！')
      this.setState({
        showLogin: false
      })
    })
  }

  private handleLegitimateUser = () => {
    this.setState({
      showLogin: false
    }, () => {
      this.loadShareContent()
    })
  }

  public render () {
    const {
      title,
      widgets,
      display,
      slide,
      layers,
      layersInfo
    } = this.props

    const {
      scale,
      showLogin,
      shareInfo,
      headlessBrowserRenderSign,
      WidgetExecuteFailedTag,
      executeQueryFailed
    } = this.state

    const loginPanel = showLogin ? <Login shareInfo={shareInfo} legitimateUser={this.handleLegitimateUser} /> : null

    let content = null
    let previewStyle = null
    if (display) {
      const { scale } = this.state
      const slideParams = slide ? JSON.parse(slide.config).slideParams : {}
      previewStyle = this.getPreviewStyle(slideParams)
      const slideStyle = this.getSlideStyle(slideParams, scale)
      const layerItems =  Array.isArray(widgets) ? layers.map((layer) => {
        const widget = widgets.find((w) => w.id === layer.widgetId)
        const model = widget && widget.model && JSON.parse(widget.model)
        const layerId = layer.id
        const { polling, frequency } = JSON.parse(layer.params)
        const { datasource, loading, interactId, renderType } = layersInfo[layerId]

        return (
          <LayerItem
            key={layer.id}
            pure={true}
            itemId={layerId}
            widget={widget}
            model={model}
            datasource={datasource}
            layer={layer}
            loading={loading}
            polling={polling}
            frequency={frequency}
            interactId={interactId}
            renderType={renderType}
            onGetChartData={this.getChartData}
            executeQueryFailed={executeQueryFailed}
          />
        )
      }) : null
      content = (
        <div
          className={styles.board}
          style={slideStyle}
          ref={this.displayCanvas}
        >
          {layerItems}
        </div>
      )
    }
    return (
      <div className={mainStyles.container}>
        <div className={styles.preview} style={previewStyle}>
          <Helmet title={title} />
          {content}
          {loginPanel}
        <HeadlessBrowserIdentifier
          renderSign={headlessBrowserRenderSign}
          WidgetExecuteFailedTag={WidgetExecuteFailedTag}
          parentNode={this.displayCanvas.current}
        />
        </div>
      </div>
    )
  }
}

const mapStateToProps = createStructuredSelector({
  title: makeSelectTitle(),
  display: makeSelectDisplay(),
  slide: makeSelectSlide(),
  layers: makeSelectLayers(),
  widgets: makeSelectWidgets(),
  layersInfo: makeSelectLayersInfo()
})

export function mapDispatchToProps (dispatch) {
  return {
    onLoadDisplay: (token, resolve, reject) => dispatch(loadDisplay(token, resolve, reject)),
    onGetBaseInfo: (resolve) => dispatch(getBaseInfo(resolve)),
    onLoadLayerData: (renderType, layerId, dataToken, requestParams) => dispatch(loadLayerData(renderType, layerId, dataToken, requestParams)),
    onExecuteQuery: (renderType, layerId, dataToken, requestParams, resolve, reject, parameters) => dispatch(executeQuery(renderType, layerId, dataToken, requestParams, resolve, reject, parameters)),
    onGetProgress: (execId, resolve, reject) => dispatch(getProgress(execId, resolve, reject)),
    onGetResult: (execId, renderType, layerId, dataToken, requestParams, resolve, reject) => dispatch(getResult(execId, renderType, layerId, dataToken, requestParams, resolve, reject))
  }
}

const withConnect = connect(mapStateToProps, mapDispatchToProps)
const withReducer = injectReducer({ key: 'shareDisplay', reducer })
const withSaga = injectSaga({ key: 'shareDisplay', saga })

export default compose(
  withReducer,
  withSaga,
  withConnect
)(Display)
