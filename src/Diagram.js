import React from "react";
import PropTypes from "prop-types";
import memoizeOne from "memoize-one";
import _throttle from "lodash/throttle";
import invariant from "invariant";

import createIntervalTree from "./lib/intervalTree";
import Edges from "./Edges";
import { getAddedOrRemovedItems } from "./helper";

const MARGIN = 100;

function getXUpper(vertex) {
  return (vertex.left || 0) + (vertex.width || 0);
}

function getYUpper(vertex) {
  return (vertex.top || 0) + (vertex.height || 0);
}

const getExtremeVertices = memoizeOne(vertices => {
  return vertices.reduce(
    (res, vertex) => {
      if (getXUpper(res.rightMostVertex) < getXUpper(vertex)) {
        res.rightMostVertex = vertex;
      }

      if (getYUpper(res.bottomMostVertex) < getYUpper(vertex)) {
        res.bottomMostVertex = vertex;
      }

      return res;
    },
    {
      rightMostVertex: { left: -1, width: 0 },
      bottomMostVertex: { top: -1, height: 0 }
    }
  );
});

function getVerticesMap(vertices) {
  return new Map(vertices.map((v, index) => [v.id, { vertex: v, index }]));
}

const getVisibleVertices = memoizeOne(
  (universalVerticesMap, visibleEdgesMap, version) => {
    const visibleVertices = new Map();
    visibleEdgesMap.forEach(edge => {
      visibleVertices.set(
        edge.sourceId,
        universalVerticesMap.get(edge.sourceId)
      );
      visibleVertices.set(
        edge.targetId,
        universalVerticesMap.get(edge.targetId)
      );
    });

    return visibleVertices;
  }
);

const getVisibleEdges = memoizeOne(
  (viewport, xIntervalTree, yIntervalTree, version) => {
    const xEdgesMap = new Map();
    const yEdgesMap = new Map();
    const visibleVertices = new Map();
    xIntervalTree.queryInterval(
      viewport.xMin,
      viewport.xMax,
      ([low, high, edge]) => {
        xEdgesMap.set(edge.id, edge);
      }
    );
    yIntervalTree.queryInterval(
      viewport.yMin,
      viewport.yMax,
      ([low, high, edge]) => {
        yEdgesMap.set(edge.id, edge);
      }
    );

    xEdgesMap.forEach((edge, edgeId) => {
      if (yEdgesMap.has(edgeId)) {
        visibleVertices.set(edgeId, edge);
      }
    });

    return visibleVertices;
  }
);

function addEdge(vToEMap, edge, vertexId) {
  let sourceVertexEdgeList = vToEMap.get(vertexId);
  if (sourceVertexEdgeList) {
    sourceVertexEdgeList.push(edge);
  } else {
    vToEMap.set(vertexId, [edge]);
  }
}

function removeEdge(vToEMap, edgeId, vertexId) {
  let sourceVertexEdgeList = vToEMap.get(vertexId);
  if (sourceVertexEdgeList) {
    sourceVertexEdgeList = sourceVertexEdgeList.filter(
      presentEdge => presentEdge.id !== edgeId
    );
  }
  if (!sourceVertexEdgeList || !sourceVertexEdgeList.length) {
    vToEMap.delete(vertexId);
  } else {
    vToEMap.set(vertexId, sourceVertexEdgeList);
  }
}

const getViewport = memoizeOne(
  (scrollLeft, scrollTop, clientWidth, clientHeight) => ({
    xMin: scrollLeft,
    xMax: scrollLeft + clientWidth,
    yMin: scrollTop,
    yMax: scrollTop + clientHeight
  })
);

function removeNode(intervalTree, intervalTreeNodes, nodeId) {
  if (!intervalTreeNodes[nodeId]) {
    return;
  }
  intervalTree.remove(intervalTreeNodes[nodeId]);
  delete intervalTreeNodes[nodeId];
}

function makeXIntervalForEdge(edge, v1, v2) {
  const x1 = Math.min(v1.left, v2.left) || 0;
  const x2 = Math.max(
    (v1.left || 0) + (v1.width || 0),
    (v2.left || 0) + (v2.width || 0)
  );
  return [x1, x2, edge];
}

function makeYIntervalForEdge(edge, v1, v2) {
  const y1 = Math.min(v1.top, v2.top) || 0;
  const y2 = Math.max(
    (v1.top || 0) + (v1.height || 0),
    (v2.top || 0) + (v2.height || 0)
  );
  return [y1, y2, edge];
}

class Diagram extends React.PureComponent {
  constructor(props) {
    super(props);
    this.state = {
      scroll: {
        left: 0,
        top: 0
      },
      container: {
        height: 0,
        width: 0
      },
      version: 0,
      isContainerElReady: false
    };
    this.containerRef = React.createRef();
    const { verticesMap } = this.setVertices(props.vertices);
    this.initVerticesToEdgesMap(props.edges);
    this.initIntervalTrees(props.edges, verticesMap);
  }

  componentDidMount() {
    const { height, width } = this.containerRef.current.getBoundingClientRect();

    this.setState({
      container: {
        height,
        width
      },
      isContainerElReady: true
    });
  }

  componentDidUpdate(prevProps, prevState, snapshot) {
    let shouldTriggerRender = false;
    const didVerticesChange = prevProps.vertices !== this.props.vertices;
    let { verticesMap, verticesToEdgesMap } = this;

    if (didVerticesChange) {
      verticesMap = this.setVertices(this.props.vertices).verticesMap;
    }

    if (this.revalidateNodes) {
      this.verticesToBeValidated.forEach(vertex =>
        this.plumbInstance.revalidate(vertex.id)
      );
      this.revalidateNodes = false;
    }

    if (prevProps.edges !== this.props.edges) {
      verticesToEdgesMap = this.updateEdges(
        getAddedOrRemovedItems(prevProps.edges, this.props.edges),
        verticesMap
      ).verticesToEdgesMap;
      shouldTriggerRender = true;
    }

    if (didVerticesChange) {
      const { itemsAdded, itemsRemoved } = getAddedOrRemovedItems(
        prevProps.vertices,
        this.props.vertices
      );

      this.revalidateNodes = true;
      this.verticesToBeValidated = itemsAdded;

      this.updateIntervalTrees(
        { itemsAdded, itemsRemoved },
        verticesToEdgesMap
      );
      shouldTriggerRender = true;
    }

    if (shouldTriggerRender) {
      this.setState(({ version }) => ({ version: version + 1 }));
    }
  }

  setVertices(vertices) {
    this.vertices = vertices;
    this.verticesMap = getVerticesMap(vertices);
    return { vertices: this.vertices, verticesMap: this.verticesMap };
  }

  addToXIntervalTree = (edge, verticesMap) => {
    const edgeId = edge.id;
    if (this.xIntervalTreeNodes[edgeId]) {
      return;
    }

    const sourceVertex = verticesMap.get(edge.sourceId);
    invariant(sourceVertex, `sourceVertex missing for the edgeId - ${edgeId}`);
    const targetVertex = verticesMap.get(edge.targetId);
    invariant(targetVertex, `targetVertex missing for the edgeId - ${edgeId}`);

    const interval = makeXIntervalForEdge(
      edge,
      sourceVertex.vertex,
      targetVertex.vertex
    );
    this.xIntervalTreeNodes[edgeId] = interval;
    this.xIntervalTree.insert(interval);
  };

  addToYIntervalTree = (edge, verticesMap) => {
    const edgeId = edge.id;

    if (this.yIntervalTreeNodes[edgeId]) {
      return;
    }

    const sourceVertex = verticesMap.get(edge.sourceId);
    invariant(sourceVertex, `sourceVertex missing for the edgeId - ${edgeId}`);
    const targetVertex = verticesMap.get(edge.targetId);
    invariant(targetVertex, `targetVertex missing for the edgeId - ${edgeId}`);

    const interval = makeYIntervalForEdge(
      edge,
      sourceVertex.vertex,
      targetVertex.vertex
    );

    this.yIntervalTreeNodes[edgeId] = interval;
    this.yIntervalTree.insert(interval);
  };

  initIntervalTrees(edges, verticesMap) {
    this.initXIntervalTree(edges, verticesMap);
    this.initYIntervalTree(edges, verticesMap);
  }

  initVerticesToEdgesMap(edges) {
    this.verticesToEdgesMap = edges.reduce((vToEMap, edge) => {
      addEdge(vToEMap, edge, edge.sourceId);
      addEdge(vToEMap, edge, edge.targetId);
      return vToEMap;
    }, new Map());
  }

  addEdgeToVerticesToEdgesMap = edge => {
    addEdge(this.verticesToEdgesMap, edge, edge.sourceId);
    addEdge(this.verticesToEdgesMap, edge, edge.targetId);
  };

  removeEdgeFromVerticesToEdgesMap = edge => {
    removeEdge(this.verticesToEdgesMap, edge.id, edge.sourceId);
    removeEdge(this.verticesToEdgesMap, edge.id, edge.targetId);
  };

  initXIntervalTree(edges, verticesMap) {
    this.xIntervalTree = createIntervalTree();
    this.xIntervalTreeNodes = {};
    edges.forEach(edge => this.addToXIntervalTree(edge, verticesMap));
  }

  initYIntervalTree(edges, verticesMap) {
    this.yIntervalTree = createIntervalTree();
    this.yIntervalTreeNodes = {};
    edges.forEach(edge => this.addToYIntervalTree(edge, verticesMap));
  }

  updateIntervalTrees({ itemsAdded, itemsRemoved }, verticesToEdgesMap) {
    itemsRemoved.forEach(vertex => {
      const vertexId = vertex.id;
      const edges = verticesToEdgesMap.get(vertexId) || [];
      edges.forEach(edge => {
        removeNode(this.xIntervalTree, this.xIntervalTreeNodes, edge.id);
        removeNode(this.yIntervalTree, this.yIntervalTreeNodes, edge.id);
      });
    });
    itemsAdded.forEach(vertex => {
      const edges = verticesToEdgesMap.get(vertex.id);
      const { verticesMap } = this;
      edges.forEach(edge => {
        this.addToXIntervalTree(edge, verticesMap);
        this.addToYIntervalTree(edge, verticesMap);
      });
    });
  }

  updateEdges({ itemsAdded, itemsRemoved }, verticesMap) {
    itemsRemoved.forEach(edge => {
      const edgeId = edge.id;
      this.removeEdgeFromVerticesToEdgesMap(edge);
      removeNode(this.xIntervalTree, this.xIntervalTreeNodes, edgeId);
      removeNode(this.yIntervalTree, this.yIntervalTreeNodes, edgeId);
    });
    itemsAdded.forEach(edge => {
      this.addEdgeToVerticesToEdgesMap(edge);
      this.addToXIntervalTree(edge, verticesMap);
      this.addToYIntervalTree(edge, verticesMap);
    });

    return { verticesToEdgesMap: this.verticesToEdgesMap };
  }

  updateScroll = _throttle(target => {
    this.setState({
      scroll: {
        left: target.scrollLeft,
        top: target.scrollTop
      }
    });
  }, 0);

  handleScroll = e => {
    if (e.target !== e.currentTarget) {
      return;
    }
    this.updateScroll(e.currentTarget);
  };

  getVisibleEdges() {
    const { scroll, container, version } = this.state;

    return getVisibleEdges(
      getViewport(scroll.left, scroll.top, container.width, container.height),
      this.xIntervalTree,
      this.yIntervalTree,
      version
    );
  }

  getVisibleVertices() {
    const { version } = this.state;

    return getVisibleVertices(
      this.verticesMap,
      this.getVisibleEdges(),
      version
    );
  }

  getExtremeXAndY() {
    const { rightMostVertex, bottomMostVertex } = getExtremeVertices(
      this.vertices
    );

    const sentinelX = getXUpper(rightMostVertex) + MARGIN;
    const sentinelY = getYUpper(bottomMostVertex) + MARGIN;

    return [sentinelX, sentinelY];
  }

  registerPlumbInstance = plumbInstance => {
    this.plumbInstance = plumbInstance;
  };

  renderSentinel(x, y) {
    return (
      <div
        style={{
          height: 1,
          width: 1,
          position: "absolute",
          left: 0,
          top: 0,
          transform: `translate3d(${x}px, ${y}px, 0)`
        }}
      />
    );
  }

  renderBackground(x, y) {
    return this.props.renderBackground(x, y);
  }

  renderVertices(vertices) {
    return vertices.map(({ vertex, index }) => (
      <React.Fragment key={vertex.id}>
        {this.props.renderVertex({ vertex, index })}
      </React.Fragment>
    ));
  }

  renderEdges(edgesMap, vertices) {
    if (!this.state.isContainerElReady) {
      return null;
    }

    return (
      <Edges
        registerPlumbInstance={this.registerPlumbInstance}
        onAction={this.props.onAction}
        edges={[...edgesMap.values()]}
        vertices={vertices.map(v => v.vertex)}
        containerEl={this.containerRef.current}
        sourceEndpointStyles={this.props.sourceEndpointStyles}
        sourceEndpointOptions={this.props.sourceEndpointOptions}
        targetEndpointStyles={this.props.targetEndpointStyles}
        targetEndpointOptions={this.props.targetEndpointOptions}
        edgeStyles={this.props.edgeStyles}
        draggableOptions={this.props.draggableOptions}
        droppableOptions={this.props.droppableOptions}
        areVerticesDraggable={this.props.areVerticesDraggable}
      />
    );
  }

  render() {
    const visibleVerticesMap = this.getVisibleVertices();
    const edges = this.getVisibleEdges();

    const vertices = [...visibleVerticesMap.values()];
    const [extremeX, extremeY] = this.getExtremeXAndY();

    return (
      <div
        style={{ height: "100%", overflow: "auto", position: "relative" }}
        ref={this.containerRef}
        className="diagramContainer"
        onScroll={this.handleScroll}
      >
        {this.renderVertices(vertices)}
        {this.renderEdges(edges, vertices)}
        {this.renderSentinel(extremeX, extremeY)}
        {this.renderBackground(extremeX, extremeY)}
      </div>
    );
  }
}

Diagram.propTypes = {
  vertices: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      left: PropTypes.number,
      top: PropTypes.number
    })
  ),
  draggableOptions: PropTypes.shape({
    grid: PropTypes.arrayOf(PropTypes.number),
    consumeStartEvent: PropTypes.bool,
    getConstrainingRectangle: PropTypes.func,
    containment: PropTypes.bool
  }),
  droppableOptions: PropTypes.shape({
    canDrop: PropTypes.func,
    hoverClass: PropTypes.string
  }),
  renderBackground: PropTypes.func
};

Diagram.defaultProps = {
  edges: [],
  renderBackground() {
    return null;
  },
  areVerticesDraggable: true
};

export default Diagram;
