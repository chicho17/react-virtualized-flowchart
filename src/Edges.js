import React, { PureComponent } from "react";
import PropTypes from "prop-types";
import { jsPlumb } from "jsplumb";

import { ACTION_TYPES } from "./constants"
import Overlays from "./Overlays";
import { getAddedOrRemovedItems, getOverlays } from "./helper";

class Edges extends PureComponent {
  state = {
    overlayEdges: []
  };

  componentDidMount() {
    jsPlumb.ready(() => {
      this.plumbInstance = jsPlumb.getInstance(this.props.containerEl);
      this.props.registerPlumbInstance(this.plumbInstance);
      this.plumbConnections = {};
      this.drawConnections();
      this.makeVerticesDraggable(this.props.vertices);
      this.plumbInstance.bind('click', this.handleConnectionClick);
    });
  }

  componentDidUpdate(prevProps) {
    if (prevProps.vertices !== this.props.vertices) {
      this.updateVertices(
        getAddedOrRemovedItems(prevProps.vertices, this.props.vertices)
      );
    }
    if (prevProps.edges !== this.props.edges) {
      this.updateConnections(
        getAddedOrRemovedItems(prevProps.edges, this.props.edges)
      );
    }
  }

  handleStop = dragEndEvent => {
    this.props.onAction({
      type: ACTION_TYPES.ITEM_DRAGGED,
      payload: {
        vertexEl: dragEndEvent.el,
        finalPos: dragEndEvent.finalPos
      }
    });
  };

  handleDrop = dropEndEvent => {
    this.props.onAction({
      type: ACTION_TYPES.ITEM_DROPPED,
      payload: {
        dropEndEvent
      }
    });
  };

  handleConnectionClick = (connection, event) => {
    event.stopPropagation();
    this.props.onAction({
      type: ACTION_TYPES.CONNECTION_CLICK,
      payload: {
        id: connection.getParameter('id'),
      },
    });
  };

  unmanageVertices(verticesRemoved, verticesUpdated) {
    verticesRemoved.map(vertex => {
      this.plumbInstance.unmanage(vertex.id);
    });
    verticesUpdated.map(vertex => {
      this.plumbInstance.destroyDraggable(vertex.id);
    });
  }

  makeVerticesDraggable(vertices) {
    vertices.forEach(vertex => {
      this.plumbInstance.draggable(vertex.id, {
        ...this.props.draggableOptions,
        stop: this.handleStop
      });
      if (
        !this.plumbInstance
          .getElement(vertex.id)
          .classList.contains("jtk-droppable")
      ) {
        this.plumbInstance.droppable(vertex.id, {
          ...this.props.droppableOptions,
          drop: this.handleDrop
        });
      }
    });
  }

  updateConnections({ itemsAdded, itemsRemoved }) {
    this.removeConnectionsAndEndpoints(itemsRemoved);
    this.addConnectionsAndEndpoints(itemsAdded);
    this.setState({ overlayEdges: this.props.edges });
  }

  updateVertices({ itemsAdded, itemsRemoved, itemsUpdated }) {
    this.unmanageVertices(itemsRemoved, itemsUpdated);
    this.makeVerticesDraggable(itemsAdded);
  }

  removeConnectionsAndEndpoints = (removedEdges = []) => {
    removedEdges.forEach(edge => {
      const connection = this.plumbConnections[edge.id];
      const connectionEndpoints = connection.endpoints;

      this.plumbInstance.deleteConnection(connection);
      this.plumbInstance.deleteEndpoint(connectionEndpoints[0]);
      this.plumbInstance.deleteEndpoint(connectionEndpoints[1]);
    });
  };

  addConnectionsAndEndpoints = (addedEdges = []) => {
    addedEdges.forEach(edge => {
      const { sourceId, targetId } = edge;
      const sourceEndpoint = this.plumbInstance.addEndpoint(sourceId, {
          ...(edge.sourceEndpointStyles || this.props.sourceEndpointStyles),
          ...(edge.sourceEndpointOptions || this.props.sourceEndpointOptions),
          isSource: true
        }),
        targetEndpoint = this.plumbInstance.addEndpoint(targetId, {
          ...(edge.targetEndpointStyles || this.props.targetEndpointStyles),
          ...(edge.targetEndpointOptions || this.props.targetEndpointOptions),
          isTarget: true
        });

      this.plumbConnections[edge.id] = this.plumbInstance.connect({
        ...(edge.styles || this.props.edgeStyles),
        ...(edge.options || this.props.edgeOptions),
        source: sourceEndpoint,
        target: targetEndpoint,
        parameters: {
          id: edge.id,
        }
        overlays: getOverlays(edge)
      });
    });
  };

  drawConnections() {
    this.addConnectionsAndEndpoints(this.props.edges);
    this.setState({ overlayEdges: this.props.edges });
  }

  render() {
    return (
      <Overlays
        edges={this.state.overlayEdges}
        renderOverlays={this.props.renderOverlays}
      />
    );
  }
}

Edges.displayName = "Edges";
Edges.propTypes = {
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
  renderOverlays: PropTypes.func
};
Edges.defaultProps = {
  sourceEndpointStyles: {
    paintStyle: { radius: 1 },
    connectorPaintStyle: { stroke: "blue", strokeWidth: 0 }
  },
  sourceEndpointOptions: {
    anchor: "Bottom"
  },
  targetEndpointStyles: {
    paintStyle: { fill: "blue", radius: 1 },
    connectorPaintStyle: { stroke: "blue", strokeWidth: 0 }
  },
  targetEndpointOptions: {
    anchor: "Top"
  },
  edgeStyles: {
    paintStyle: { stroke: "black" },
    connector: ["Flowchart", { curviness: 0, cornerRadius: 20 }]
  }
};

export default Edges;
